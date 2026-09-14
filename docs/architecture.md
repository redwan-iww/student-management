# Architecture & Decisions

Hand-written. Everything else in `docs/` is generated from `schema/model.yaml`.

## Shape of the project

One canonical schema, four generated targets:

```
schema/model.yaml  ──┬──>  build/postgres.sql   Postgres DDL (fullstack target)
schema/enums.yaml  ──┼──>  build/zoho/*.json    Zoho CRM metadata payloads
                     ├──>  build/types.ts       TypeScript for the React widget
                     └──>  docs/*.md            ERD, data dictionary, Zoho map
```

`schema/*.yaml` is the only file anyone edits. `npm run gen` rebuilds the rest.
If the CRM and the spec ever disagree, the spec wins and the CRM gets corrected.

## Decisions

### 1. `classes` is split into `classes` + `class_sessions`

The original note listed one "classes" table, which conflates the **section**
(MATH101 Section A, Term 1, Mon/Wed 10:00, capacity 25) with the **session**
(that section on 2026-02-03). Attendance attaches to sessions. Without the split
there is nowhere to record who actually took a given lesson, or to cancel and
reschedule one. `class_sessions` rows are generated from the section's
`meeting_days` + `start_date`/`end_date`.

### 2. Teachers are a module, not CRM users

The demo org has 2 user licences. A `Teachers` module with an optional
`crm_user` lookup lets unlicensed staff be referenced from allocations and
attendance without a seat each.

### 3. Attendance is one record per student per session

The cheap alternative — a subform of attendees on each session — was rejected:
subform rows cannot be queried, filtered or reported on independently, and
attendance reporting is the point of the feature. Volume is roughly
`students x classes-each x sessions-per-term` per term, which matters for Zoho
API credits and argues for bulk-write on the nightly/entry path.

### 4. Contacts carries the household

Zoho's `Contacts` is natively a *person* module. We use it as
"household + primary guardian", with secondary-guardian fields alongside. The
canonical spec keeps `households` a distinct entity, so moving to
Accounts-as-household later is a mapping change, not a remodel.

### 5. Two fields are denormalized on purpose

`enrollments.course` / `enrollments.term` and `attendance.student` /
`attendance.class` duplicate data reachable through a parent. Zoho COQL cannot
join two hops, so "every enrollment in Term 1" is unanswerable unless the term
sits on the enrollment row. Marked `derived_from` in the spec; kept in step by a
workflow field-update in Zoho and a `BEFORE INSERT OR UPDATE` trigger in Postgres.

### 6. Frontend is a React app delivered as a Zoho CRM widget

Hence `build/types.ts`: record interfaces, picklist string-literal unions, and a
`ZOHO_MODULES` map so widget code never hard-codes an api_name.

```ts
import { ZOHO_MODULES } from './types';
const { module, fields } = ZOHO_MODULES.attendance;
ZOHO.CRM.API.insertRecord({ Entity: module, APIData: {
  [fields.status]: 'Present',
  [fields.class_session]: { id: sessionId },
}});
```

A rename in `schema/model.yaml` then breaks the build instead of failing silently
at runtime.

## Target organisation

**demo 4** — `org735208498`. `Contacts` is the given parent module; every other
entity is a custom module. Recorded in `schema/target-org.yaml`.

### This org is not reachable from the current connectors

| Connector | Organisation | zgid | Creates modules |
|---|---|---|---|
| `claude.ai Zoho CRM` | Demo Id / `demo3` | `731242989` | no (`createFields` only) |
| `claude.ai instawebworks` | Insta Web Works (production, AU) | `638310255` | yes |
| — | **demo 4** ← the target | `735208498` | **no connector** |

Applying `build/zoho/` therefore needs a connector authorised against demo 4,
or a person running the runbook by hand. Until then the payloads are built and
waiting.

**Profile IDs are org-specific.** Copying them between orgs fails with
`Invalid profile id`; that error is how this three-org situation was found.
`build/zoho/modules.json` ships with `profiles: []` and a warning until
`schema/target-org.yaml` is filled from `getProfiles` **on demo 4**.

## Findings from the demo3 audit (2026-09-14)

These describe the **Demo Id / demo3** org, not demo 4 and not production. They
are kept because they are what the schema was shaped against; re-run the audit
against demo 4 before applying.

- `Students` (CustomModule45) exists with stock system fields only — usable as-is.
- `Courses` (CustomModule2) holds the `Courses` api_name but is `status:
  user_hidden` and COQL returns `NO_PERMISSION`. It can be neither read nor
  safely reused, so the catalog module is `Course_Catalog` with the user-facing
  labels Course / Courses.
- 2 user licences, 0 portal licences.
- ~156 modules from unrelated past projects. Never reuse a module on name alone.

## Proven against a live org

The `households` (Contacts) and `students` (Students) entities were built for
real in **demo3** on 2026-09-14 to validate the generated payloads before anyone
runs them on demo 4. 23 custom fields plus the Contacts→Students lookup were
created; `generators/verify-zoho.mjs` then reported **no drift** for both.

Four things only the live API could teach us, all now encoded in the generators:

1. `unique` is rejected on `autonumber` — *"unique is not supported for data
   type autonumber"*. The flag is now dropped for the Zoho target only; the SQL
   target still emits a UNIQUE constraint.
2. `Notes` is a reserved **api_name** — `RESERVED_KEYWORD_NOT_ALLOWED`.
3. `Notes` is *separately* reserved as a **field_label** — *"System keyword not
   allowed in field label"*. Two different checks; passing one does not pass the
   other. Both are now build-time validations.
4. **Mandatory is layout config, not field metadata.** `system_mandatory` sent to
   `createFields` returns SUCCESS but does not take effect, and `getFields` does
   not report it reliably. Required fields must be set through the **layout** API
   after creation. `verify-zoho.mjs` reports these as INFO rather than drift.

Also corrected: stock `Mailing_Street` is `text`, not `textarea`.

Consequence for the demo 4 build: **send the generated payload verbatim.** The
one hand-edited call in this session silently dropped four mandatory flags —
and demo3's connector has no `updateField`, so they could not be repaired.

## Zoho limits the generators already account for

- `field_label` max 25 characters.
- `tooltip` `static_text` max 35 chars, `info_icon` max 255 — we use `info_icon`.
- No native time type — `start_time`/`end_time` are `HH:MM` text.
- No composite unique field — `(student, class)` and `(enrollment, class_session)`
  need a custom function that COQL-counts on create/edit. See
  `build/zoho/validations.json`.
- Rollup summaries cannot divide, so `enrollments.attendance_rate` needs two
  count rollups plus a formula field.
- The stock `Name` display field is always text and cannot *be* an auto-number,
  so `admissions`, `enrollments`, `allocations` and `attendance` each carry a
  separate auto-number field and compose `Name` by workflow.

## Still open

1. **Reaching demo 4.** No connected MCP connector is authorised for
   `org735208498`. Either authorise one (claude.ai connector settings) or apply
   `build/zoho/00-plan.json` by hand. Re-audit for api_name collisions first —
   the `Course_Catalog` fallback was forced by a collision in demo3 that may
   not exist in demo 4.
2. **Who can actually mark attendance.** A CRM widget cannot be called from
   outside the CRM: `ZOHO.embeddedApp.init()` completes through a postMessage
   handshake with the parent CRM page, so the widget URL loaded on its own never
   initialises. There is no "send teachers a link to the widget" option, and the
   Client Portal does not host widgets either. So the widget commits us to
   **every teacher who marks attendance holding a CRM licence**.

   If that is not affordable, attendance capture needs a *second* delivery
   surface — a separately hosted React app authenticating with server-side OAuth
   and writing through the REST API — while the widget stays the in-CRM admin
   view. Both surfaces can share `build/types.ts` and `ZOHO_MODULES`, so the
   cost is hosting and an auth flow, not a second data model.

   The data model is unaffected either way: `attendance.marked_by` points at the
   `Teachers` module, not at a CRM user, precisely so an unlicensed teacher can
   still be recorded as the person who took the class.
3. **Room booking.** `classes.room` is plain text. If room-conflict detection is
   wanted, `rooms` becomes an entity.
