# Who can do what

For *where* these are enforced in Zoho and in a fullstack app, see
[roles-enforcement.md](roles-enforcement.md).

Access for each role, per table.

**Key:** C = create · R = read · U = update · D = delete · — = no access

| Table | Admin | Admissions | Coordinator | Teacher | Accounts |
|---|---|---|---|---|---|
| Contacts (family) | CRUD | CRU | R | — | RU |
| Students | CRUD | CRU | RU | R (own classes) | R |
| Admissions | CRUD | CRU | R | — | R |
| Terms | CRUD | R | CRU | R | R |
| Programs / Courses | CRUD | R | CRU | R | R |
| Classes | CRUD | R | CRU | R | R |
| Class_Sessions | CRUD | — | CRU | RU (topic, notes) | — |
| Enrollments | CRUD | CR | CRU | R | RU (fees) |
| Allocation | CRUD | — | CRU | R (own) | — |
| Attendance | CRUD | — | R | CRU (own classes) | — |
| Teachers | CRUD | — | R | R (self) | — |

## Roles

| Role | Who they are |
|---|---|
| Admin | Principal or office manager. Sets up the system and sees everything. |
| Admissions | Handles enquiries and applications. |
| Coordinator | Plans terms, courses, classes and timetables, and assigns teachers. |
| Teacher | Takes lessons and marks attendance. |
| Accounts | Tracks fees and payments. |

Parents and guardians have no access to the system. The family is stored as a Contacts record, and if a parent needs information they contact the office.

## Notes

- **Only Admin deletes records.**

## What this means for Zoho

The nine scheduling and attendance modules are **team modules**, living in a team
space; `Contacts`, `Students` and `Course_Catalog` are ordinary **organization**
modules. The two answer to different permission systems, so each role below is
granted twice — once as a team profile, once as an org profile.

- **Team modules: the role becomes a team profile.** A team space offers exactly
  five, and they are fixed — you cannot add a sixth. They differ by *record
  ownership*, not by action:

  | Team profile | Sees | Writes |
  |---|---|---|
  | Admins | everything, plus fields/permissions/config | everything (max **5 per module**) |
  | Managers | all records | all records |
  | Members | all records | only records they own |
  | Participants | only records they own | only records they own |
  | Requesters | no module access | submits via the My Requests tab |

- **There is no read-only team profile.** Every "view" cell in the table above has
  to be built as Member (or Participant) with create/edit/delete stripped off in
  the per-profile action permissions. That customisation is per module, done by a
  team module Admin, and it is the part that will drift if nobody writes it down.
- **Org modules: the role becomes an org profile**, as before — module and
  field-level create/view/edit/delete. `Accounts` editing fees but nothing else on
  an enrollment is field-level security on the team module, not a profile.
- **"Own classes" is now mostly free.** Participant already means "own records
  only", so a Teacher set as Participant on Class_Sessions and Attendance is
  confined to their own rows without a single sharing rule — *provided the record
  Owner is set to the allocated teacher*. That owner-setting is still the load-
  bearing part; see [roles-enforcement.md](roles-enforcement.md).
- **Licences.** Everyone still needs a licence, but team modules unlock a cheaper
  one: a **Team User** (~$9–11/user/month) works inside team modules plus up to 10
  org modules, and every team user shares a single org profile named "Team User".
  Teachers fit that shape exactly. demo3 holds **2 full user licences and 0 portal
  licences** (confirmed 2026-09-19), so the full-licence wall now applies only to
  Admin / Admissions / Coordinator / Accounts. Neither the 25-profile cap nor the
  team profile count is the constraint — licences are.

## The same, as a list

- **Admin** can do everything: create, view, edit and delete every table.

- **Admissions** can create, view and edit families (Contacts)
- **Admissions** can create, view and edit students
- **Admissions** can create, view and edit applications (Admissions)
- **Admissions** can enroll students into classes
- **Admissions** can view terms, courses and classes
- **Admissions** can view enrollments

- **Coordinator** can create, view and edit terms
- **Coordinator** can create, view and edit programs and courses
- **Coordinator** can create, view and edit classes
- **Coordinator** can create, view and edit lessons (Class_Sessions)
- **Coordinator** can create, view and edit enrollments
- **Coordinator** can assign teachers to classes (Allocation)
- **Coordinator** can view and edit students
- **Coordinator** can view families, applications, attendance and teachers

- **Teacher** can mark attendance for their own classes
- **Teacher** can edit lesson topics and notes
- **Teacher** can view students in their own classes
- **Teacher** can view terms, courses, classes and enrollments
- **Teacher** can view their own allocations
- **Teacher** can view their own teacher record

- **Accounts** can view and edit families (billing status)
- **Accounts** can view and edit enrollments (fees and payment status)
- **Accounts** can view students, applications, terms, courses and classes

Only Admin can delete records.
