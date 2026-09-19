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

`plugin-manifest.json` registers **two** widgets at `location: crm.webtab` —
`class_allocation` and `attendance_manager`. Being widgets *hosted as* web tabs
is what makes the SDK handshake work; a plain Web Tab pointing at an external URL
gets no handshake and would need server-side OAuth instead. Neither reads a record
from `PageLoad` (a web tab has no record context), so each picks its own subject.

1. `npm run build`
2. Build the installable zip. The layout must match the manifest's URLs exactly:
   `plugin-manifest.json` at the **root**, everything else under `app/`.

   ```
   plugin-manifest.json
   app/class-allocation.html
   app/attendance-manager.html
   app/logo.png
   app/assets/…
   ```

   Two traps, both hit on 2026-09-19:

   - **`zet pack` omitted `plugin-manifest.json`** from its `dist/ext.zip`, which
     makes the zip uninstallable. Check the entry list before uploading.
   - **`Compress-Archive` on Windows PowerShell 5.1 writes `app\file` with
     backslashes**, which unzippers read as one flat filename rather than a
     folder. Build entry names with forward slashes explicitly.

   A working zip is committed-adjacent at `dist-ext/` (gitignored).

3. Install it in the target org under **Setup → Developer Space → Extensions**
   (or register each widget separately under **Widgets**). No API covers this —
   neither the first-party Zoho CRM connector nor any MCP tool exposes widgets or
   web tabs, so this step is manual.
4. `logo.png` is required — the manifest references `/app/logo.png` and the tab
   renders without an icon if it is missing.
5. `whiteListedDomains` and `cspDomains` are both empty. If either tab ever calls
   anything outside Zoho, they must be filled in first or the request is blocked.

### Seeing them before packaging

`npm run dev` serves both entries and installs a mock `ZOHO` global (see
`src/zoho/mock.ts`), so the real component tree and the real `client.ts` call path
run against in-memory fixtures — a yellow banner says as much. That proves the UI
and the generated field mappings, but **not** the SDK handshake. For that, use
`zet run` and register its local URL as the widget URL.

## What is built

`src/components/AttendanceSheet.tsx` — the teacher-facing screen. Loads the
session, pulls active enrollments for its class, merges any marks already
recorded, and writes back one `Attendance` record per student. Writes are
sequential on purpose: Zoho rate-limits bursts, and a partial failure is easier
to reason about in order. The upsert is manual because
`(enrollment, class_session)` is not a native Zoho unique constraint.
