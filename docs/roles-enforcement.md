# How roles are enforced

The roles and access levels themselves are in [permissions.md](permissions.md). This
file is about *where* they are enforced in each target.

Right now they are enforced in neither. `permissions.md` is prose; nothing in
Zoho or in the SQL reads it.

## In Zoho

As built in demo3 on 2026-09-19, the modules are split across **two** permission
systems. `build/zoho/00-plan.json` carries the authoritative list under
`_access_model`:

| | Modules | Governed by |
|---|---|---|
| `team_based` | Teachers, Terms, Academic_Programs, Admissions, Classes, Class_Sessions, Enrollments, Allocations, Attendance | the team space's five private profiles |
| `org_based` | Contacts, Students, Course_Catalog | org profiles + role hierarchy + sharing rules |

This was not the original design — the spec asked for ten org modules. The nine
were created through the CRM for Everyone "Create Module" form, which puts a new
module in a team space by default. It was kept deliberately: team profiles turn
out to express the hardest rule here more cheaply than sharing rules do, and team
users are a cheaper licence. The cost is that every access question now has two
answers depending on which module you are asking about.

### 1. Team profiles — the nine team modules

Five fixed profiles per team space, assigned per module, distinguished by record
ownership rather than by action: **Admins** (full control of the module, max 5),
**Managers** (all records), **Members** (read all, write own), **Participants**
(own records only), **Requesters** (no module access; submits through My
Requests). Any user can be made a team Admin or Member regardless of the org
profile they hold.

Two consequences worth internalising:

- **No read-only profile exists.** "Coordinator may view enrollments" becomes
  Member with create/edit/delete removed in that module's per-profile action
  permissions. Field-level permissions are per-profile too, which is where
  "Accounts edits fees only" lives.
- **Only two visibility levels: all records, or own.** Anything in between —
  "a teacher sees the roster of their own class but no other" — is not
  expressible, because reading a classmate's Enrollment means reading a record
  they do not own. Member over-shares; Participant under-shares. See the open
  question below.

### 2. Record owner — the "own classes" part

Participant already means "own records only", so the rule mostly falls out of
ownership. The load-bearing step is therefore setting the **Owner** of
Class_Sessions and Attendance to the allocated teacher — by workflow field-update
off the Allocation, since nothing does it automatically. Get that wrong and
Participants see nothing at all.

A custom function on save that rejects a write when the user holds no Active
Allocation for that class is still worth having as a belt-and-braces check,
because ownership can be reassigned by hand.

### 3. Org profiles, roles and sharing rules — the three org modules

Unchanged for `Contacts`, `Students` and `Course_Catalog`: one org profile per
role setting module and field-level create/view/edit/delete, the role hierarchy
deciding *whose* records are visible under a Private sharing model, and sharing
rules or territories for anything crossing the hierarchy. Note `Course_Catalog`
currently grants Administrator and `Nasir` but **not** Standard — a leftover from
the module it was renamed from.

### What the two web tabs need

Both run as the logged-in user, so the team profile a person holds *is* the
tab's access. Per tab:

| Web tab | Module | Needs | Team profile that gives it |
|---|---|---|---|
| `class_allocation` | Terms, Classes, Teachers | read all | Manager (or Member) |
| `class_allocation` | Allocations | create, edit, end | Manager |
| `attendance_manager` | Class_Sessions | read own | Participant, **if Owner is the teacher** |
| `attendance_manager` | Attendance | create, edit own | Participant |
| `attendance_manager` | Enrollments | **read all rows of one class** | *nothing fits — see below* |

So `class_allocation` is fine: it is a Coordinator tool, and Manager on those
four modules is exactly right.

#### The roster blocker

`attendance_manager` builds its sheet from `getEnrollmentsForClass`. An
enrollment belongs to the student, not the teacher, so a Teacher set as
**Participant** on Enrollments reads none of them and **the attendance sheet comes
back empty**. This is the all-records-or-own limit, hit where it actually hurts.

Setting the Enrollment Owner to the teacher does not rescue it: an enrollment is
one student in one class, but a class can have several allocated teachers and a
student sits in several classes — one Owner field cannot express that.

Options, in order of preference:

1. **Teacher = Member on Enrollments** (read all, write own), Participant
   everywhere else. Costs least-privilege on one module — a teacher could list
   every enrollment in the school — but needs no code change and no schema
   change. Recommended unless enrollment data is considered sensitive.
2. **Move Enrollments to an org module** and express "the roster of my own
   classes" as a sharing rule off Allocations. Keeps least privilege; costs a
   module rebuild and puts a third permission seam through the model.
3. **Read the roster through a service account** — the widget calls a backend
   holding its own OAuth token. Defeats the point of running as the logged-in
   user, and re-introduces the hosting and auth work that decision 6 avoided.

Option 1 until someone objects; this is the decision to revisit first if
attendance ever misbehaves for a teacher.

### Still open on the team-based side

- **The roster visibility gap** described above. If teachers must read the
  enrollments of their own class only, neither Member nor Participant fits, and
  the honest options are a widget that queries as a service account, or moving
  Enrollments back to an org module with a sharing rule.
- **Five business roles onto five fixed team profiles** is a coincidence, not a
  mapping. Admin→Admins, Coordinator→Managers, Admissions→Members, Teacher→
  Participants leaves Accounts to be a Member with almost everything stripped.
- **Max 5 Admins per team module** caps how many people can change a team
  module's fields or permissions.

Web tabs and widgets change none of this. They run as the logged-in user, so Zoho
applies the same team or org permissions there as in the CRM UI.

## In a normal fullstack app

Zoho gives you profiles and roles for free. In your own app you build them, and
**the current schema has no users or roles tables** — a real gap in the fullstack
target, since `teachers.crm_user` only holds a Zoho user id.

Roughly what is needed:

```
app_users     id, email, password_hash, teacher_id (nullable)
roles         id, name          -- admin, admissions, coordinator, teacher, accounts
user_roles    user_id, role_id  -- a person can hold more than one
```

Then enforcement, in one of two places.

### API middleware — the usual approach

Each endpoint declares what it needs:

```
POST /attendance    requires 'attendance:create'
```

and for the "own classes" rule the handler checks the data:

```sql
-- may this user mark attendance on this session?
SELECT 1 FROM allocations a
JOIN class_sessions s ON s.class_id = a.class_id
WHERE s.id = $1 AND a.teacher_id = $2 AND a.status = 'Active'
```

### Or Postgres row-level security

The rule sits in the database, so it holds even if someone queries directly:

```sql
CREATE POLICY teacher_own_attendance ON attendance
  FOR ALL USING (
    class_id IN (SELECT class_id FROM allocations
                 WHERE teacher_id = current_setting('app.teacher_id')::bigint)
  );
```

RLS is stricter and harder to bypass; middleware is easier to read and debug. For
a school-sized system, middleware first, and RLS later only if direct database
access becomes a worry.

## The two sides compared

| | Zoho | Fullstack |
|---|---|---|
| Table access | Profiles | `roles` + middleware checks |
| Field access | Field-level security in the profile | Pick fields per role in the API |
| Record access | Role hierarchy + record owner | `WHERE` clauses, or RLS policies |
| "Own classes" | Sharing rules or a custom function | A join against `allocations` |
| Where it is configured | CRM Setup screens, by hand | Code and migrations |
| Who can change it | Any Zoho admin, silently | Requires a commit and a deploy |

That last row is the practical difference. In Zoho someone can widen a profile
with a few clicks and nothing records why; in your own app it is a reviewable
change.

## Open suggestion

`permissions.md` is prose, so the two targets will drift the moment anyone edits a
Zoho profile. The same approach used for the fields would fix it: a
`schema/permissions.yaml` listing each role and its access, generating the Zoho
profile payloads, the SQL policies, and the markdown table.

Not built — it is speculative until the modules exist in demo3. The alternative,
keeping permissions as a document people read, is also a reasonable call.
