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

- **Each role becomes a Zoho profile.** The profile controls which of these tables that person can see and edit.
- **"Own classes" needs sharing rules.** Profiles alone can't limit a teacher to their own classes' attendance, so this limit also needs sharing rules or territories.
- **Licences.** Every role here needs a CRM licence, and so does every teacher. demo3 has only 2 licences, so check how many demo 4 has before going further.

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
