# Data Dictionary

<!-- GENERATED FILE -- do not edit. Source: schema/model.yaml (npm run gen:docs) -->

11 entities. Rollup fields are derived — they exist as a Zoho
rollup summary field, never as stored data.

## Household — `households`

Family or billing unit. In Zoho this rides on the stock Contacts module, so one record is "the household plus its primary guardian". The entity is kept distinct in this spec so a future move to Accounts-as-household is a mapping change, not a remodel.

Zoho module `Contacts` (extend_standard)

| Field | Type | Req | Unique | Zoho api_name | Notes |
|---|---|:-:|:-:|---|---|
| `household_name` | text | ✓ |  | `Last_Name` | Stock Zoho display field. Holds e.g. 'Rahman Family'. |
| `household_code` | autonumber |  | ✓ | `Household_Code` |  |
| `primary_guardian_name` | text | ✓ |  | `Primary_Guardian_Name` |  |
| `primary_guardian_relationship` | enum `guardian_relationship` |  |  | `Primary_Guardian_Relationship` |  |
| `email` | email |  |  | `Email` |  |
| `phone` | phone |  |  | `Phone` |  |
| `mobile` | phone |  |  | `Mobile` |  |
| `secondary_guardian_name` | text |  |  | `Secondary_Guardian_Name` |  |
| `secondary_guardian_relationship` | enum `guardian_relationship` |  |  | `Secondary_Guardian_Relationship` |  |
| `secondary_guardian_phone` | phone |  |  | `Secondary_Guardian_Phone` |  |
| `secondary_guardian_email` | email |  |  | `Secondary_Guardian_Email` |  |
| `preferred_contact_method` | enum `contact_method` |  |  | `Preferred_Contact_Method` | default `Email` |
| `address_line` | text |  |  | `Mailing_Street` | Zoho stock Mailing_Street is text, not textarea. |
| `city` | text |  |  | `Mailing_City` |  |
| `postcode` | text |  |  | `Mailing_Zip` |  |
| `country` | text |  |  | `Mailing_Country` |  |
| `billing_status` | enum `billing_status` |  |  | `Billing_Status` | default `Current` |
| `notes` | textarea |  |  | `Household_Notes` | api_name is not 'Notes' -- Zoho reserves that keyword. |
| `active_students_count` | rollup(count of `students`) |  |  | _(rollup)_ |  |

## Student — `students`

The learner. Always belongs to exactly one household.

Zoho module `Students` (extend_custom)

| Field | Type | Req | Unique | Zoho api_name | Notes |
|---|---|:-:|:-:|---|---|
| `full_name` | text | ✓ |  | `Name` | Stock display field. Keep in step with first_name + last_name. |
| `student_code` | autonumber |  | ✓ | `Student_Code` |  |
| `student_ref` | text |  | ✓ | `Student_Ref` | The readable identity: STU-<term>-<application serial>, taken from the student's FIRST admission, so it says when they joined and never changes afterwards. The prefix used to be the programme they were admitted to; this school has no majors -- a student is admitted to a term and picks courses -- so there was nothing for it to name. Composed on write, not autonumbered: student_code is an autonumber and Zoho silently ignores writes to those -- an update reports SUCCESS and leaves the old value in place. |
| `household` | reference → `households` | ✓ |  | `Household` |  |
| `first_name` | text | ✓ |  | `First_Name` |  |
| `last_name` | text | ✓ |  | `Last_Name` |  |
| `date_of_birth` | date |  |  | `Date_Of_Birth` |  |
| `gender` | enum `gender` |  |  | `Gender` |  |
| `status` | enum `student_status` | ✓ |  | `Status` | default `Prospective` |
| `email` | email |  |  | `Email` |  |
| `phone` | phone |  |  | `Phone` |  |
| `enrollment_date` | date |  |  | `Enrollment_Date` |  |
| `signup_term` | reference → `terms` |  |  | `Signed_Up_For` | The term this student signed up for. The sign-up lives on the student rather than in a module of its own: one person signing up once, for one term, paying once. |
| `fee_total` | currency |  |  | `Fee_Total` | What the chosen courses come to. Charged per sign-up, not per course -- the admissions rows are only created once this is settled. |
| `fee_paid` | currency |  |  | `Fee_Paid` | default `0` |
| `payment_status` | enum `payment_status` | ✓ |  | `Payment_Status` | Admissions rows are created when this reaches Paid or Waived. Before that the student has chosen courses but is not admitted to any of them.; default `Unpaid` |
| `exit_date` | date |  |  | `Exit_Date` |  |
| `emergency_contact_name` | text |  |  | `Emergency_Contact_Name` |  |
| `emergency_contact_phone` | phone |  |  | `Emergency_Contact_Phone` |  |
| `medical_notes` | textarea |  |  | `Medical_Notes` |  |
| `photo` | image |  |  | `Record_Image` |  |
| `active_enrollments_count` | rollup(count of `admissions`) |  |  | _(rollup)_ |  |

## Teacher — `teachers`

Teaching staff. A separate module rather than CRM users because the org holds only 2 user licences; crm_user links the minority who do have one.

Zoho module `Teachers` (create)

| Field | Type | Req | Unique | Zoho api_name | Notes |
|---|---|:-:|:-:|---|---|
| `full_name` | text | ✓ |  | `Name` |  |
| `staff_code` | autonumber |  | ✓ | `Staff_Code` |  |
| `email` | email |  | ✓ | `Email` | Stock field: every Zoho custom module ships with Email + Secondary_Email. Creating it returns DUPLICATE_DATA (hit 2026-09-19 on Teachers). |
| `phone` | phone |  |  | `Phone` |  |
| `crm_user` | user_reference |  |  | `CRM_User` | Null for unlicensed staff. Set only when the teacher has a CRM seat. |
| `employment_type` | enum `teacher_employment_type` |  |  | `Employment_Type` |  |
| `specialisms` | multi_enum `academic_level` |  |  | `Specialisms` |  |
| `status` | enum `teacher_status` | ✓ |  | `Status` | default `Active` |
| `joined_on` | date |  |  | `Joined_On` |  |
| `notes` | textarea |  |  | `Teacher_Notes` | api_name is not 'Notes' -- Zoho reserves that keyword. |

## Term — `terms`

An academic term/session. Classes and enrollments are scoped to one.

Zoho module `Terms` (create)

| Field | Type | Req | Unique | Zoho api_name | Notes |
|---|---|:-:|:-:|---|---|
| `name` | text | ✓ |  | `Name` | e.g. '2026 Term 1' |
| `term_code` | text | ✓ | ✓ | `Term_Code` | e.g. '2026T1' |
| `academic_year` | integer | ✓ |  | `Academic_Year` |  |
| `sequence_no` | integer |  |  | `Sequence_No` | Order within the academic year: 1, 2, 3... |
| `start_date` | date | ✓ |  | `Start_Date` |  |
| `end_date` | date | ✓ |  | `End_Date` |  |
| `enrollment_opens` | date |  |  | `Enrollment_Opens` |  |
| `enrollment_closes` | date |  |  | `Enrollment_Closes` |  |
| `status` | enum `term_status` | ✓ |  | `Status` | default `Planned` |

**Constraints**

- `term_dates_ordered` — check `end_date >= start_date`

## Holiday — `holidays`

A date or date range on which no lesson is held. Scoped to a term when it is a term-specific closure, or left unscoped to apply across the whole calendar -- which is what a public holiday needs.

Zoho module `Holidays` (create)

| Field | Type | Req | Unique | Zoho api_name | Notes |
|---|---|:-:|:-:|---|---|
| `name` | text | ✓ |  | `Name` | e.g. 'Eid ul-Fitr', 'Victory Day' |
| `start_date` | date | ✓ |  | `Start_Date` |  |
| `end_date` | date |  |  | `End_Date` | Leave blank for a single day. Inclusive when set. |
| `term` | reference → `terms` |  |  | `Term` | Blank applies it to every term, which is right for a public holiday. |
| `kind` | enum `holiday_kind` | ✓ |  | `Kind` | default `Public Holiday` |
| `notes` | textarea |  |  | `Holiday_Notes` | api_name is not 'Notes' -- Zoho reserves that keyword. |

**Constraints**

- `holiday_dates_ordered` — check `end_date IS NULL OR end_date >= start_date`

## Course — `courses`

What is taught. A course has no date and no teacher -- that is a `classes` row. The Zoho module name is forced by the target org: demo3 already holds an unrelated `Courses` (CustomModule2).

Zoho module `Course_Catalog` (create)

| Field | Type | Req | Unique | Zoho api_name | Notes |
|---|---|:-:|:-:|---|---|
| `name` | text | ✓ |  | `Name` |  |
| `course_code` | text | ✓ | ✓ | `Course_Code` |  |
| `description` | textarea |  |  | `Description` |  |
| `level` | enum `academic_level` |  |  | `Level` |  |
| `contact_hours` | decimal |  |  | `Contact_Hours` |  |
| `default_capacity` | integer |  |  | `Default_Capacity` | default `20` |
| `default_fee` | currency |  |  | `Default_Fee` |  |
| `status` | enum `catalog_status` | ✓ |  | `Status` | default `Active` |

## Admission — `admissions`

One student admitted to one course. Five courses chosen is five rows. This is the record a place in a class is made against, and it carries the class once the placement is made -- so one row is the whole life of "this person takes this subject": admitted, placed, marked, graded. It used to be an application made before any student existed, with the applicant's own name and guardian held inline. That is gone: a student signs up first (see students.signup_term and the fee fields on it), and only once the fee is settled is a row created here per course chosen. Holding applicant details here would have repeated one person's date of birth once per subject they take.

Zoho module `Admissions` (create)

| Field | Type | Req | Unique | Zoho api_name | Notes |
|---|---|:-:|:-:|---|---|
| `name` | text | ✓ |  | `Name` | Zoho stock display field -- always text, so it cannot BE the auto-number. Workflow-composed from application_no. |
| `application_no` | autonumber |  | ✓ | `Application_No` |  |
| `student` | reference → `students` | ✓ |  | `Student` |  |
| `course` | reference → `courses` | ✓ |  | `Course` | The subject admitted to. Chosen at sign-up; a class running it comes later. |
| `term` | reference → `terms` | ✓ |  | `Term` |  |
| `class` | reference → `classes` |  |  | `Class` | Which run of the course they were put in. Empty until placed, which is what the enrolment board does -- an admitted-but-unplaced row is exactly what its left panel lists. |
| `source` | enum `admission_source` |  |  | `Source` |  |
| `stage` | enum `admission_stage` | ✓ |  | `Stage` | default `Admitted` |
| `applied_date` | date | ✓ |  | `Applied_Date` |  |
| `placed_on` | date |  |  | `Placed_On` |  |
| `dropped_on` | date |  |  | `Dropped_On` |  |
| `drop_reason` | textarea |  |  | `Drop_Reason` |  |
| `final_grade` | text |  |  | `Final_Grade` |  |
| `attendance_rate` | rollup(percent of `attendance`) |  |  | _(rollup)_ |  |
| `notes` | textarea |  |  | `Admission_Notes` | api_name is not 'Notes' -- Zoho reserves that keyword. |

**Constraints**

- `uq_admission_student_course_term` — unique (student, course, term) — One admission per subject per term. Zoho has no composite unique field -- enforced by validation rule. See docs/zoho-mapping.md.

## Class — `classes`

A section/batch: course x term x weekly timetable. NOT a dated lesson -- that is `class_sessions`. Attendance never attaches here.

Zoho module `Classes` (create)

| Field | Type | Req | Unique | Zoho api_name | Notes |
|---|---|:-:|:-:|---|---|
| `name` | text | ✓ |  | `Name` | e.g. 'MATH101 - 2026T1 - A' |
| `class_code` | text | ✓ | ✓ | `Class_Code` |  |
| `course` | reference → `courses` | ✓ |  | `Course` |  |
| `term` | reference → `terms` | ✓ |  | `Term` |  |
| `section_label` | text |  |  | `Section_Label` | e.g. 'A', 'B', 'Evening' |
| `primary_teacher` | reference → `teachers` |  |  | `Primary_Teacher` |  |
| `room` | text |  |  | `Room` |  |
| `capacity` | integer | ✓ |  | `Capacity` | default `20` |
| `meeting_days` | multi_enum `weekday` |  |  | `Meeting_Days` | The weekly pattern that class_sessions rows are generated from. |
| `start_time` | time |  |  | `Start_Time` |  |
| `end_time` | time |  |  | `End_Time` |  |
| `start_date` | date | ✓ |  | `Start_Date` |  |
| `end_date` | date | ✓ |  | `End_Date` |  |
| `status` | enum `class_status` | ✓ |  | `Status` | default `Draft` |
| `enrolled_count` | rollup(count of `admissions`) |  |  | _(rollup)_ |  |
| `sessions_count` | rollup(count of `class_sessions`) |  |  | _(rollup)_ |  |

**Constraints**

- `class_dates_ordered` — check `end_date >= start_date`
- `class_capacity_positive` — check `capacity > 0`

## Class Session — `class_sessions`

A single dated meeting of a class, generated from the weekly pattern on `classes`. teacher_taken records who actually ran it, which may differ from the class primary_teacher (substitutions).

Zoho module `Class_Sessions` (create)

| Field | Type | Req | Unique | Zoho api_name | Notes |
|---|---|:-:|:-:|---|---|
| `name` | text | ✓ |  | `Name` | Auto-composed: '<class_code> - <session_date>' |
| `class` | reference → `classes` | ✓ |  | `Class` |  |
| `session_date` | date | ✓ |  | `Session_Date` |  |
| `start_time` | time |  |  | `Start_Time` |  |
| `end_time` | time |  |  | `End_Time` |  |
| `sequence_no` | integer |  |  | `Sequence_No` | 1-based ordinal within the class. |
| `teacher_taken` | reference → `teachers` |  |  | `Teacher_Taken` |  |
| `status` | enum `session_status` | ✓ |  | `Status` | default `Scheduled` |
| `topic` | text |  |  | `Topic` |  |
| `notes` | textarea |  |  | `Session_Notes` | api_name is not 'Notes' -- Zoho reserves that keyword. |
| `attendance_taken` | boolean |  |  | `Attendance_Taken` | default `false` |
| `attendance_taken_at` | datetime |  |  | `Attendance_Taken_At` |  |
| `present_count` | rollup(count of `attendance`) |  |  | _(rollup)_ |  |
| `absent_count` | rollup(count of `attendance`) |  |  | _(rollup)_ |  |

**Constraints**

- `uq_session_per_class_date` — unique (class, session_date)

## Allocation — `allocations`

Teacher assigned to a class. class_session is NULL for a whole-term allocation and set only for a one-off substitution on that date.

Zoho module `Allocations` (create)

| Field | Type | Req | Unique | Zoho api_name | Notes |
|---|---|:-:|:-:|---|---|
| `name` | text | ✓ |  | `Name` | Zoho stock display field -- always text, so it cannot BE the auto-number. Workflow-composed from allocation_no. |
| `allocation_no` | autonumber |  | ✓ | `Allocation_No` |  |
| `teacher` | reference → `teachers` | ✓ |  | `Teacher` |  |
| `class` | reference → `classes` | ✓ |  | `Class` |  |
| `class_session` | reference → `class_sessions` |  |  | `Class_Session` | NULL = allocation covers the whole class. Set = single-session substitution. |
| `role` | enum `allocation_role` | ✓ |  | `Role` | default `Lead Teacher` |
| `effective_from` | date |  |  | `Effective_From` |  |
| `effective_to` | date |  |  | `Effective_To` |  |
| `status` | enum `allocation_status` | ✓ |  | `Status` | default `Planned` |
| `notes` | textarea |  |  | `Allocation_Notes` | api_name is not 'Notes' -- Zoho reserves that keyword. |

**Constraints**

- `allocation_dates_ordered` — check `effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from`

## Attendance — `attendance`

One mark per admitted student per session. `student` and `class` are denormalized off the admission for the same COQL reason admissions is. Highest-volume table: students x classes-each x sessions-per-term.

Zoho module `Attendance` (create)

| Field | Type | Req | Unique | Zoho api_name | Notes |
|---|---|:-:|:-:|---|---|
| `name` | text | ✓ |  | `Name` | Zoho stock display field -- always text, so it cannot BE the auto-number. Workflow-composed from attendance_no. |
| `attendance_no` | autonumber |  | ✓ | `Attendance_No` |  |
| `class_session` | reference → `class_sessions` | ✓ |  | `Class_Session` |  |
| `admission` | reference → `admissions` | ✓ |  | `Admission` |  |
| `student` | reference → `students` | ✓ |  | `Student` | derived from `admission.student` |
| `class` | reference → `classes` | ✓ |  | `Class` | derived from `admission.class` |
| `status` | enum `attendance_status` | ✓ |  | `Status` | default `Present` |
| `minutes_late` | integer |  |  | `Minutes_Late` | default `0` |
| `marked_by` | reference → `teachers` |  |  | `Marked_By` | The teacher who took the class and recorded the mark. |
| `marked_at` | datetime |  |  | `Marked_At` |  |
| `remarks` | textarea |  |  | `Remarks` |  |

**Constraints**

- `uq_attendance_admission_session` — unique (admission, class_session) — Zoho: enforced by validation rule, not a native composite unique.
- `attendance_minutes_late_nonneg` — check `minutes_late >= 0`

## Enumerations

- `billing_status` — `Current`, `Overdue`, `On Hold`, `Closed`
- `guardian_relationship` — `Mother`, `Father`, `Grandparent`, `Legal Guardian`, `Sibling`, `Other`
- `contact_method` — `Email`, `Phone`, `SMS`, `WhatsApp`
- `gender` — `Male`, `Female`, `Other`, `Prefer Not To Say`
- `student_status` — `Prospective`, `Active`, `On Hold`, `Withdrawn`, `Graduated`, `Alumni`
- `teacher_employment_type` — `Full Time`, `Part Time`, `Contract`, `Visiting`
- `teacher_status` — `Active`, `On Leave`, `Inactive`
- `term_status` — `Planned`, `Open`, `In Progress`, `Closed`, `Archived`
- `catalog_status` — `Draft`, `Active`, `Inactive`, `Retired`
- `academic_level` — `Foundation`, `Beginner`, `Intermediate`, `Advanced`, `Professional`
- `admission_stage` — `Admitted`, `Placed`, `Completed`, `Dropped`, `Withdrawn`
- `admission_source` — `Walk In`, `Website`, `Referral`, `Social Media`, `Agent`, `Event`, `Other`
- `class_status` — `Draft`, `Scheduled`, `Running`, `Completed`, `Cancelled`
- `weekday` — `Monday`, `Tuesday`, `Wednesday`, `Thursday`, `Friday`, `Saturday`, `Sunday`
- `holiday_kind` — `Public Holiday`, `Religious Holiday`, `School Closure`, `Term Break`, `Exam Period`, `Other`
- `session_status` — `Scheduled`, `Held`, `Cancelled`, `Rescheduled`, `Makeup`
- `enrollment_status` — `Pending`, `Active`, `Completed`, `Dropped`, `Transferred`
- `payment_status` — `Unpaid`, `Partially Paid`, `Paid`, `Waived`, `Refunded`
- `allocation_role` — `Lead Teacher`, `Assistant`, `Substitute`, `Observer`
- `allocation_status` — `Planned`, `Active`, `Ended`, `Cancelled`
- `attendance_status` — `Present`, `Absent`, `Late`, `Excused`, `Left Early`
