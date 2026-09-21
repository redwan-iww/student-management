# Opening a New Term

Hand-written. The admin runbook for standing up a new term and its subjects.

For *what* each field means see [data-dictionary.md](data-dictionary.md); for the
shape of the model see [erd.md](erd.md).

## The order is not a style choice

`Classes.Course` and `Classes.Term` are both **required** references. Nothing in
delivery can exist until the calendar and catalog rows it points at already do.
That forces the sequence below:

```
Terms ─────────────┐
                   ├──> Classes ──> Class Sessions ──> Attendance
Programs ──> Courses ┘        └──> Allocations
                              └──> Enrollments
```

Steps 1–3 are independent and can be done in any order, or in parallel.
Step 4 onward is strictly sequential.

## Before you start: two decisions

**Is the term length in calendar days or teaching days?**
The existing terms treat it as *calendar days, inclusive* — `end_date = start_date + (n - 1)`.
A 50-day term starting 2027-07-05 therefore ends 2027-08-23, about 7.1 weeks.
Read as *teaching* days the same "50" would mean a ~17-week term. These are very
different terms; settle it before creating anything.

**Are the new subjects new courses, or new programs too?**
A subject is a `Course_Catalog` row. It needs a new `Academic_Programs` row only
if it does not fit an existing program. `Course.Program` is optional — you may
leave it blank, but the course will then roll up into no program's `Courses` count.

## Step 1 — Term

No dependencies.

| Field | |
|---|---|
| `Name` | required — e.g. `Term 4 (2027)` |
| `Term_Code` | required, **unique org-wide** — e.g. `T4-2027` |
| `Academic_Year` | required |
| `Start_Date`, `End_Date` | required; `End_Date >= Start_Date` is enforced |
| `Sequence_No` | order within the academic year |
| `Enrollment_Opens`, `Enrollment_Closes` | set before `Start_Date` so intake has a window |
| `Status` | required — start at `Planned` |

Status lifecycle: `Planned` → `Open` → `In Progress` → `Closed` → `Archived`.
Move to `Open` when you are ready to accept enrolments.

## Step 2 — Programs (only if needed)

Required: `Name`, `Program_Code` (**unique**), `Status`.
`Courses` is a rollup — it counts courses pointing here; never set it by hand.

## Step 3 — Courses

One row per subject. Required: `Name`, `Course_Code` (**unique**), `Status`.

`Course_Code` is unique **org-wide**, and a course carries no term of its own, so
codes must be term-scoped by convention: `BUS101-T4-2027`, not `BUS101`. A bare
code will collide the first time the same subject runs again.

Set `Default_Capacity` and `Default_Fee` here. Classes and enrollments copy from
them rather than re-deriving, so getting them right now saves work downstream.

> A course is a *catalog entry*, independent of when it runs. The schema would
> happily let one `Mathematics 101` row be reused by classes in three different
> terms. Creating one course per subject *per term* is a convention, not a
> requirement — but it is the convention this data follows.

## Step 4 — Classes

**This is the gate.** One class per course, each pinning one course into one term.

| Field | |
|---|---|
| `Name`, `Class_Code` | required; `Class_Code` **unique** — e.g. `BUS101-T4-2027-A` |
| `Course`, `Term` | **required** references |
| `Capacity` | required, must be > 0 |
| `Start_Date`, `End_Date` | required; normally mirror the term |
| `Meeting_Days`, `Start_Time`, `End_Time` | the weekly pattern |
| `Section_Label` | `A`, `B`, `Evening` … |
| `Status` | required — starts `Draft` |

Status lifecycle: `Draft` → `Scheduled` → `Running` → `Completed` (or `Cancelled`).

**Do not skip `Meeting_Days`.** It is the pattern that step 5 expands; without it
there is nothing to generate sessions from.

`Enrolled` and `Sessions` are rollups — derived, never set.

## Step 5 — Generate Class Sessions

Expand each class's weekly pattern across its date range, one row per dated
meeting, named `<class_code> - <session_date>` and numbered with `Sequence_No`.

Yield for a 50-day (7.1-week) term:

| Weekly pattern | Sessions per class |
|---|---|
| Mon + Wed | 15 |
| Tue + Thu | 14 |
| Saturday | 7 |

Five twice-weekly classes ≈ **75 sessions**.

A unique constraint on `(class, session_date, start_time)` means re-running the
generator is safe — it cannot double-book the same slot.

This step is pure mechanism and should not be done by hand.

## Step 6 — Allocations

A lead teacher per class. Required: `Name`, `Teacher`, `Class`, `Role`,
`Effective_From`.

`Class_Sessions.Teacher_Taken` records who *actually* ran a given date, which may
differ from the allocation — that is how substitutions are captured. Leave it
alone at setup time.

## Step 7 — Intake

Admissions → Students → Enrollments, in that order.

- **Admissions** — `Stage` runs `Enquiry` → … → `Enrolled`.
- **Students** — link to a household (`Contacts`).
- **Enrollments** — one per student per class. `Course` and `Term` are
  denormalized copies of `class.course` / `class.term`; set them consistently or
  leave them for the class to supply.

## Step 8 — Run and close

Mark attendance per session. `Present` / `Absent` roll up onto the session, and
`Attendance_Taken` / `Attendance_Taken_At` flag which registers are outstanding.

At the end: classes → `Completed`, term → `Closed`.

## Things that will bite you

**Never write autonumber fields.** `Application_No`, `Enrollment_No`,
`Allocation_No`, `Student_Code`, `Household_Code` and `Attendance_No` are assigned
by the server. Sending a value is rejected or silently ignored.

**`Name` is mandatory on every custom module** — including Admissions and
Allocations, where there is no obvious natural name. A create without it fails
with `MANDATORY_NOT_FOUND`.

**Deletion protection cuts both ways.** Above Classes the rule is `restrict`: you
cannot delete a term or a course while any class still points at it, so remove
classes first. At and below Classes it is `cascade`: deleting a class silently
takes its sessions, enrollments and attendance with it.

**Attendance is what scales, not sessions.** Sessions are bounded by
classes × weeks. Attendance is one row per enrolled student per session, so the
same 75 sessions become **1,500 attendance rows** at a capacity of 20. Size
reports and record limits against that number.

**Check the org before writing.** Three Zoho orgs have been in play and profile
IDs do not port between them. Confirm `getOrganization` returns zgid `731242989`
(demo3) first. See the connector table in [architecture.md](architecture.md).
