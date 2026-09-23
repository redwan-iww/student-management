# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## The one rule that governs everything

`schema/model.yaml` and `schema/enums.yaml` are the **single source of truth**. Everything in
`build/`, `docs/` and `src/generated/` is generated from them and must never be hand-edited —
each generated file carries a `GENERATED FILE -- do not edit` banner.

To change the data model: edit the YAML, run `npm run gen`, and review the diff in `build/` and
`docs/`. **That diff is the change.** Editing a generated file works until the next `npm run gen`
silently reverts it.

The generators validate as they load, and a violation fails the build rather than producing a
broken target: unknown enum values, an enum default that isn't one of its values, dangling `ref:`,
a reference with no `on_delete`, duplicate field names, duplicate Zoho api_names, bad rollup
targets, and Zoho reserved keywords in either a field's `label` or its `api_name`.

That last one is easy to trip: a field labelled `Notes` is rejected outright. Look at how
`households.notes` and `class_sessions.notes` do it — both relabel *and* override `api_name`.

## Commands

```bash
npm install

# schema pipeline
npm run gen           # regenerate every target from schema/*.yaml
npm run verify:types  # type-check build/types.ts under --strict

# the app
npm run dev           # vite on http://localhost:3000
npm run build         # sync:types -> tsc -b -> vite build
npm run typecheck

# drift check against a live CRM: call getFields(module), save the JSON, then
node generators/verify-zoho.mjs <entity> <getFields.json>
```

Individually: `gen:zoho`, `gen:types`, `gen:docs`.

`dev`, `build` and `typecheck` all run `sync:types` first, which copies `build/types.ts` into
`src/generated/types.ts` — so the app can never compile against a stale copy of the schema.

**There is no test runner and no test script.** Don't invent a `npm test` invocation; there is
nothing to run.

## Two branches, two different applications

This matters more than anything else about the layout. They have diverged in both directions and
are *not* a feature branch waiting to merge.

| | `main` | `with-supabase` |
|---|---|---|
| Backend | Zoho CRM | SQLite now, Supabase later |
| Data layer | `src/zoho/` | `src/data/` |
| Generators | `gen-zoho`, `gen-types`, `gen-docs` | `gen-sql`, `gen-sqlite`, `gen-db-types`, `gen-docs` |
| Record shape | `{ Session_Date, Class: {id, name} }` | `{ session_date, class_id }` |
| Pages | 2 web tabs | 3 (adds a schema-driven Setup page) |
| Extra | — | `server/` — Express + `node:sqlite` on :3001 |

`main` is Zoho CRM **only** — the Postgres target was deliberately removed from it (`828ca0c`).
`with-supabase` has no Zoho code at all.

**Check which branch you are on before doing anything.** The same filename means different things
on each, and a change written for one will not apply to the other. Do not switch branches without
being asked.

## Architecture on `main`

A React app delivered as **two Zoho CRM widgets** registered at `location: crm.webtab`
(`plugin-manifest.json`), one HTML entry point each:

- `class-allocation.html` → staffing: term → class → who teaches it
- `attendance-manager.html` → the register: date → lesson → mark attendance

Layering: `src/zoho/sdk.ts` types and awaits the CRM handshake · `src/zoho/client.ts` is the only
file that touches the CRM · `src/apps/` and `src/components/` are the UI.

### It only runs inside CRM

`ZOHO.embeddedApp.init()` resolves through a postMessage handshake with the parent CRM page, so
opening a built page directly cannot work. Outside a frame, `TabShell` falls back to
`src/zoho/mock.ts` (in-memory fixtures, red banner) or, if `.env` holds OAuth credentials, to
`src/zoho/live.ts` (real CRM over REST via the `vite-zoho-proxy.ts` dev-server proxy). Both are
dev-only and tree-shaken from production builds.

A **web tab has no record context**, so `PageLoad` may never fire. `initTab()` therefore resolves
on *either* `PageLoad` or `init()` — waiting only on `PageLoad` made a perfectly connected tab
time out as `no-response`.

### The model's two deliberate splits

- **`classes` vs `class_sessions`.** A class is a weekly *rule* ("Mon+Wed 09:00, 5 Oct–13 Dec").
  A session is one dated occurrence. Attendance attaches to the session, never the class.
  Sessions are generated from the rule by `GenerateSessions.tsx`, skipping dates covered by
  `holidays` and `(date, start_time)` pairs that already exist, so re-running is safe.
- **Two denormalized field pairs.** `enrollments.course`/`term` and `attendance.student`/`class`
  duplicate data reachable through a parent, because Zoho COQL cannot join two hops. Marked
  `derived_from:` in the schema.

### Writing to Zoho — four rules learned the hard way

1. **`Name` is mandatory on every custom module**, including join-like ones with no natural title.
   Omitting it fails with `MANDATORY_NOT_FOUND`.
2. **Datetimes need an offset, not `Z`.** `2026-09-22T17:30:00+06:00`, not
   `toISOString()`. Use `zohoDateTime()`. Date-only columns take a plain `yyyy-MM-dd`.
3. **Updates put the record id inside `APIData`**, not only in `RecordID`. All updates go through
   `updateOne()` for this reason.
4. **Never write an autonumber field** (`Student_Code`, `Household_Code`, `Application_No`, …) —
   the server assigns them.

The SDK **rejects with a plain object, not an `Error`**, so `String(err)` renders `[object Object]`
and throws away the reason. Always use `describeError()`.

`insertRecord` accepts an array for bulk (100 max, `BULK_LIMIT`), and a bulk response has one
status row **per record** — check them all, not just `data[0]`.

## Target organisation

**demo3** — zgid `731242989`. Profile IDs are org-specific and never portable; a `createModules`
call using another org's IDs fails with `Invalid profile id`. Step 0 of `build/zoho/00-plan.json`
asserts `getOrganization` returns that zgid before anything is written — run it first.

The available Zoho CRM connector has `createFields` but **not** `createModules`, so new modules
must be created by hand in Setup → Developer Space using the generated payload in
`build/zoho/fields/`. This currently blocks the `Holidays` module, which the schema and the
timetable generator both already expect.

## Not implemented, despite the docs

`docs/permissions.md` and `docs/roles-enforcement.md` describe five roles and a per-table CRUD
matrix across ~300 lines. **None of it exists in code** — there is no current-user concept, no
login, no role check. `Teacher_Taken` and `Marked_By` are consequently always written as `null`,
so who took a register is not recorded. Treat those documents as a specification, not a
description.
