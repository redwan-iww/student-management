# Student Management — portable data model

One canonical schema for a student-management system, generated into a Zoho CRM
configuration, a Postgres database, and TypeScript for a React widget — so the
three can never drift apart.

## Layout

One project, one root. The schema pipeline and the React web tabs share a
single `package.json` and a single `node_modules`.

```
schema/model.yaml      the source of truth -- the only file you edit
schema/enums.yaml      shared picklists
generators/            model.yaml -> each target
build/postgres.sql     generated: Postgres DDL
build/zoho/            generated: Zoho CRM metadata payloads + build runbook
build/types.ts         generated: TypeScript for the React widget
docs/                  generated: ERD, data dictionary, Zoho field map
docs/architecture.md   hand-written: the decisions and why
docs/widget.md         hand-written: how the web tabs are built and deployed
docs/new-term-workflow.md  hand-written: admin runbook for opening a new term
docs/live-dev.md       hand-written: running the widgets against real CRM data

src/                   the React app -- two Zoho CRM web tabs
src/entries/           one entry per web tab
src/generated/types.ts copied from build/types.ts, never edited by hand
index.html             dev landing page, links to both tabs
class-allocation.html  web tab entry
attendance-manager.html  web tab entry
vite.config.ts         multi-page build, port 3000
plugin-manifest.json   registers both tabs with Zoho
scripts/sync-types.mjs build/types.ts -> src/generated/types.ts
```

## Commands

```bash
npm install

# schema pipeline
npm run gen           # regenerate every target
npm run verify:sql    # parse build/postgres.sql against the real Postgres grammar
npm run verify:types  # type-check build/types.ts under --strict

# the web tabs
npm run dev           # vite dev server on http://localhost:3000
npm run build         # sync types -> tsc -b -> vite build, output in dist/
npm run typecheck

# drift check: call getFields(module), save the JSON, then
node generators/verify-zoho.mjs <entity> <getFields.json>
```

Individually: `gen:sql`, `gen:zoho`, `gen:types`, `gen:docs`.

`dev`, `build` and `typecheck` all run `sync:types` first, so the app can never
compile against a stale copy of the schema.

## Changing the model

1. Edit `schema/model.yaml` (or `enums.yaml`).
2. `npm run gen`
3. `npm run verify:sql && npm run verify:types`
4. Review the diff in `build/` and `docs/` — that diff *is* the change.
5. Apply `build/zoho/` to the CRM following `build/zoho/00-plan.json`.

The generators validate as they load: unknown enum values, dangling references,
duplicate SQL columns or Zoho api_names, and bad rollup targets all fail the
build rather than producing a broken target.

## The model

12 entities: `households` `students` `teachers` `terms` `programs` `courses`
`admissions` `classes` `class_sessions` `enrollments` `allocations` `attendance`.

See `docs/erd.md` for the diagram and `docs/architecture.md` for why the model
looks the way it does — particularly the `classes` / `class_sessions` split and
the two deliberately denormalized field pairs.

## Before touching a CRM

Read the connector table in `docs/architecture.md`. The two Zoho connectors point
at **different organisations**, and only the production one can create modules.
