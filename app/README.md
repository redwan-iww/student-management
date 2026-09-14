# Student Management — Zoho CRM widget

React + TypeScript + Vite, built to run **inside** Zoho CRM as an embedded widget.

## Why it can only run inside CRM

The Zoho SDK hands the widget its context through a postMessage handshake with
the parent CRM page. `ZOHO.embeddedApp.init()` never resolves anywhere else, so
opening `dist/index.html` directly — or hosting it publicly — cannot work.
`src/zoho/sdk.ts` races `init()` against a timeout and shows an explanation
rather than hanging on a spinner.

The practical consequence: **anyone who marks attendance in this widget needs a
Zoho CRM licence.** If that is too expensive, attendance capture needs a second,
separately hosted app using server-side OAuth — see `../docs/architecture.md`.

## Field names come from the schema

`src/generated/types.ts` is copied from `../build/types.ts` by `npm run sync:types`,
which every `dev`/`build`/`typecheck` runs first. Nothing here hard-codes a Zoho
api_name; calls go through `ZOHO_MODULES`:

```ts
const { module, fields } = ZOHO_MODULES.attendance;
await ZOHO.CRM.API.insertRecord({ Entity: module, APIData: {
  [fields.status]: 'Present',
  [fields.class_session]: { id: sessionId },
}});
```

Verified: renaming `attendance.status` in `schema/model.yaml` and regenerating
produces three compile errors at the exact call sites, instead of silently
writing to a field that no longer exists.

## Commands

```bash
npm install
npm run dev        # vite dev server -- shows the "open from inside CRM" notice
npm run build      # sync types -> tsc -b -> vite build, output in dist/
npm run typecheck  # tsc -b --force
```

## Deploying to Zoho

1. `npm run build`
2. Package `dist/` with `plugin-manifest.json` using Zoho's CLI (`zet pack`), or
   upload the zip under **Setup → Developer Space → Widgets**.
3. `plugin-manifest.json` registers the widget at `crm.detailview`. Attach it to
   the **Class_Sessions** module — the widget reads the session id from
   `PageLoad` and refuses to render anywhere else.

## What is built

`src/components/AttendanceSheet.tsx` — the teacher-facing screen. Loads the
session, pulls active enrollments for its class, merges any marks already
recorded, and writes back one `Attendance` record per student. Writes are
sequential on purpose: Zoho rate-limits bursts, and a partial failure is easier
to reason about in order. The upsert is manual because
`(enrollment, class_session)` is not a native Zoho unique constraint.
