# Architecture & Decisions

Hand-written. Everything else in `docs/` is generated from `schema/model.yaml`.

## Shape of the project

One canonical schema, three generated targets:

```
schema/model.yaml  ──┬──>  build/zoho/*.json    Zoho CRM metadata payloads
schema/enums.yaml  ──┼──>  build/types.ts       TypeScript for the React widget
                     └──>  docs/*.md            ERD, data dictionary, Zoho map
```

There was a fourth, `build/postgres.sql`, generated from the same model as a
portability hedge. It was removed on 2026-09-23: this branch targets Zoho CRM
only, and a DDL nothing executes is a file that silently rots. The SQL work
lives on `with-supabase`, which carries its own generators.

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

Still correct after decision 7, but the pressure is lower: a teacher who *does*
need to log in can hold a team user licence rather than a full one.

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
workflow field-update in Zoho.

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

There are **two** surfaces, both registered in `plugin-manifest.json` at
`location: crm.webtab` — so they are widgets *hosted as* web tabs, which is what
makes the JS SDK handshake work. A plain Web Tab pointing at an external URL gets
no handshake and would need server-side OAuth instead.

| Web tab | Reads | Writes |
|---|---|---|
| `class_allocation` | Terms, Classes, Teachers, Allocations | Allocations (create / end), `Classes.Primary_Teacher` |
| `attendance_manager` | Class_Sessions, Enrollments, Attendance | Attendance (create / edit), `Class_Sessions.Attendance_Taken` |

Two things fall out of that map:

- **Every module either tab touches is `team_based`.** Neither reads Contacts,
  Students, Course_Catalog, Academic_Programs or Admissions, so neither crosses
  the org/team permission boundary at runtime. The five untouched modules are
  back-office, worked in the CRM UI.
- **Student names come from the Enrollment's `Student` lookup display value**
  (`refName` in `src/zoho/client.ts`), not from a read of Students. That is
  what keeps the roster off the org modules — worth preserving.

### 7. Nine modules are team modules, three are organization modules

Not the original design. The spec asked for ten org modules; the nine created on
2026-09-19 came out `access_type: team_based` because the CRM for Everyone
"Create Module" form puts a new module in a team space by default. `Contacts`,
`Students` and `Course_Catalog` are `org_based` (the last two because they
predate this build).

Kept rather than rebuilt, for two reasons that turned out to favour it:

1. The **Participant** team profile means "own records only" natively, which is
   the hardest rule in `permissions.md` — "a teacher marks attendance only for
   their own classes" — without a sharing rule.
2. **Team users** are a cheaper licence (~$9–11/month, all sharing one org
   profile named "Team User") and fit teachers exactly, which matters in an org
   holding 2 full licences.

The cost is two permission systems in one data model, and two real limits: there
is no read-only team profile, and team visibility is all-records-or-own with
nothing in between. `build/zoho/00-plan.json` records the split under
`_access_model`; the consequences are worked through in
[roles-enforcement.md](roles-enforcement.md).

Lookups cross the boundary without complaint — all 25 were created against a mix
of team and org modules.

## Target organisation

**demo3** — "Demo Id", zgid `731242989`, domain `org731242989`. BD/BDT,
`paid_type: zohooneenterprise`. `Contacts` is the parent module; every other
entity is a custom module. Recorded in `schema/target-org.yaml`.

Earlier drafts targeted **demo 4** (`org735208498`). That org is reachable from
no connector and was abandoned on 2026-09-19 in favour of demo3, which is both
reachable and the org the schema was actually audited against. Nothing in the
data model changed in the move — see the audit findings below.

### Connectors

| Connector | Organisation | zgid | Creates modules |
|---|---|---|---|
| `claude.ai Zoho CRM` | **demo3 ← the target** | `731242989` | **not yet** — has `createFields`, no `createModules` |
| `claude.ai instawebworks` | Insta Web Works (production, AU) | `638310255` | yes — but wrong org |
| — | demo 4 (abandoned) | `735208498` | no connector |

So step 2 of the runbook (`createModules`, 10 modules) has no usable connector
yet. The fix is to authorise a Zoho CRM connector against demo3 carrying
`ZohoCRM.settings.modules.ALL`, `.fields.ALL`, `.layouts.ALL` and
`.profiles.ALL` — the last two are what runbook steps 7 and 8 need. That is an
interactive OAuth flow, done in claude.ai connector settings.

**Profile IDs are org-specific.** Copying them between orgs fails with
`Invalid profile id`; that error is how the three-org situation was found in the
first place. `schema/target-org.yaml` now carries demo3's two default profiles
(Administrator `…26011`, Standard `…26014`, both verified live 2026-09-19), so
`build/zoho/modules.json` ships filled in. Step 0 of `00-plan.json` asserts that
`getOrganization` returns zgid `731242989` before anything is written.

### Capacity in demo3

| Resource | Enterprise cap | Used | Headroom |
|---|---|---|---|
| Profiles | 25 | 3 — Administrator, Standard, `Nasir` | 22 |
| Custom modules | 200 | 42 | +10 needed → 52 |
| User licences | — | **2 purchased**, 1 active | **the binding constraint** |

The profile cap is not the limit anyone hits here; the licence count is.
`docs/permissions.md` plans five roles — the cap allows them, the licences do
not staff them.

## Findings from the demo3 audit (2026-09-14, re-verified 2026-09-19)

The schema was shaped against these, and they are now facts about the **target**
rather than about a stand-in org:

- `Students` (CustomModule45, id `4731441000029976123`) exists, `status: visible`,
  custom and api-supported, with stock system fields only — usable as-is, hence
  `strategy: extend_custom`.
- `Courses` (CustomModule2, id `4731441000000553422`) holds the `Courses`
  api_name but is `status: user_hidden` and COQL returns `NO_PERMISSION`. It can
  be neither read nor safely reused, so the catalog module is `Course_Catalog`
  with the user-facing labels Course / Courses.
- The other nine planned api_names — `Teachers`, `Terms`, `Programs`,
  `Course_Catalog`, `Admissions`, `Classes`, `Class_Sessions`, `Enrollments`,
  `Allocations`, `Attendance` — are all free.
- 2 user licences, 0 portal licences.
- 156 modules total, 42 of them custom, mostly from unrelated past projects.
  Never reuse a module on name alone: CustomModule2 *labels itself* "Courses".

Learned while building, 2026-09-19:

- **"Program"/"Programs" is a Zoho system keyword** and is refused as a module
  name, on both Plural and Singular Name. Labels *and* api_name had to change:
  Academic Program / Academic Programs / `Academic_Programs`. Now a build-time
  check (`RESERVED_ZOHO_MODULE_NAMES`) — a third reserved-word list, separate
  from the field api_name and field label ones.
- **Every custom module ships with `Email` and `Secondary_Email`.** Creating
  `Email` returns `DUPLICATE_DATA`, which is how `teachers.email` became a stock
  field. Also a build-time check now (`CUSTOM_MODULE_STOCK_FIELDS`).
- **A rollup summary needs the live `related_list` api_name**, which equals the
  lookup's `display_label`. The generator cannot know it, so `rollups.json`
  carries the canonical filter and the api_name is resolved at apply time from
  `getRelatedLists`.

## Proven against a live org

The `households` (Contacts) and `students` (Students) entities were built for
real in **demo3** on 2026-09-14. 23 custom fields plus the Contacts→Students
lookup were created; `generators/verify-zoho.mjs` then reported **no drift** for
both. demo3 being the target rather than a rehearsal org, those two entities are
already partly built — step 1's audit is there to establish what exists before
the remaining ten modules go in.

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

Consequence for the build: **send the generated payload verbatim.** The one
hand-edited call in that session silently dropped four mandatory flags — and the
demo3 connector has no `updateField`, so they could not be repaired. Runbook
steps 7 and 8 exist to close exactly this gap, and both need scopes the current
connector lacks.

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

1. **Write scopes for demo3.** The org is reachable and the payloads are aimed
   at it, but the connector cannot create modules, update fields or update
   layouts — runbook steps 2, 7 and 8. Authorise a Zoho CRM connector against
   demo3 with `ZohoCRM.settings.modules.ALL`, `.fields.ALL`, `.layouts.ALL`,
   `.profiles.ALL` and `ZohoCRM.modules.ALL`. Collisions no longer need
   speculative re-auditing: they were verified against this org on 2026-09-19,
   and step 1 re-checks them at apply time regardless.
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
