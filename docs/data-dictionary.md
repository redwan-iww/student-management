# Data Dictionary

<!-- GENERATED FILE -- do not edit. Source: schema/model.yaml (npm run gen:docs) -->

12 entities. Rollup fields are derived — they exist as a Zoho
rollup summary and as a column on the Postgres `v_<table>` view, never as stored data.

## Household — `households`

Family or billing unit. In Zoho this rides on the stock Contacts module, so one record is "the household plus its primary guardian". The entity is kept distinct in this spec so a future move to Accounts-as-household is a mapping change, not a remodel.

SQL table `households` · Zoho module `Contacts` (extend_standard)

| Field | Type | Req | Unique | SQL column | Notes |
|---|---|:-:|:-:|---|---|
| `household_name` | text | ✓ |  | `household_name` | Stock Zoho display field. Holds e.g. 'Rahman Family'. |
| `household_code` | autonumber |  | ✓ | `household_code` |  |
| `primary_guardian_name` | text | ✓ |  | `primary_guardian_name` |  |
| `primary_guardian_relationship` | enum `guardian_relationship` |  |  | `primary_guardian_relationship` |  |
| `email` | email |  |  | `email` |  |
| `phone` | phone |  |  | `phone` |  |
| `mobile` | phone |  |  | `mobile` |  |
| `secondary_guardian_name` | text |  |  | `secondary_guardian_name` |  |
| `secondary_guardian_relationship` | enum `guardian_relationship` |  |  | `secondary_guardian_relationship` |  |
| `secondary_guardian_phone` | phone |  |  | `secondary_guardian_phone` |  |
| `secondary_guardian_email` | email |  |  | `secondary_guardian_email` |  |
| `preferred_contact_method` | enum `contact_method` |  |  | `preferred_contact_method` | default `Email` |
| `address_line` | text |  |  | `address_line` | Zoho stock Mailing_Street is text, not textarea. |
| `city` | text |  |  | `city` |  |
| `postcode` | text |  |  | `postcode` |  |
| `country` | text |  |  | `country` |  |
| `billing_status` | enum `billing_status` |  |  | `billing_status` | default `Current` |
| `notes` | textarea |  |  | `notes` | api_name is not 'Notes' -- Zoho reserves that keyword. |
| `active_students_count` | rollup(count of `students`) |  |  | _(view)_ |  |

## Student — `students`

The learner. Always belongs to exactly one household.

SQL table `students` · Zoho module `Students` (extend_custom)

| Field | Type | Req | Unique | SQL column | Notes |
|---|---|:-:|:-:|---|---|
| `full_name` | text | ✓ |  | `full_name` | Stock display field. Keep in step with first_name + last_name. |
| `student_code` | autonumber |  | ✓ | `student_code` |  |
| `household` | reference → `households` | ✓ |  | `household_id` |  |
| `first_name` | text | ✓ |  | `first_name` |  |
| `last_name` | text | ✓ |  | `last_name` |  |
| `date_of_birth` | date |  |  | `date_of_birth` |  |
| `gender` | enum `gender` |  |  | `gender` |  |
| `status` | enum `student_status` | ✓ |  | `status` | default `Prospective` |
| `email` | email |  |  | `email` |  |
| `phone` | phone |  |  | `phone` |  |
| `enrollment_date` | date |  |  | `enrollment_date` |  |
| `exit_date` | date |  |  | `exit_date` |  |
| `emergency_contact_name` | text |  |  | `emergency_contact_name` |  |
| `emergency_contact_phone` | phone |  |  | `emergency_contact_phone` |  |
| `medical_notes` | textarea |  |  | `medical_notes` |  |
| `photo` | image |  |  | `photo` |  |
| `active_enrollments_count` | rollup(count of `enrollments`) |  |  | _(view)_ |  |

## Teacher — `teachers`

Teaching staff. A separate module rather than CRM users because the org holds only 2 user licences; crm_user links the minority who do have one.

SQL table `teachers` · Zoho module `Teachers` (create)

| Field | Type | Req | Unique | SQL column | Notes |
|---|---|:-:|:-:|---|---|
| `full_name` | text | ✓ |  | `full_name` |  |
| `staff_code` | autonumber |  | ✓ | `staff_code` |  |
| `email` | email |  | ✓ | `email` | Stock field: every Zoho custom module ships with Email + Secondary_Email. Creating it returns DUPLICATE_DATA (hit 2026-09-19 on Teachers). |
| `phone` | phone |  |  | `phone` |  |
| `crm_user` | user_reference |  |  | `crm_user_id` | Null for unlicensed staff. Set only when the teacher has a CRM seat. |
| `employment_type` | enum `teacher_employment_type` |  |  | `employment_type` |  |
| `specialisms` | multi_enum `academic_level` |  |  | `specialisms` |  |
| `status` | enum `teacher_status` | ✓ |  | `status` | default `Active` |
| `joined_on` | date |  |  | `joined_on` |  |
| `notes` | textarea |  |  | `notes` | api_name is not 'Notes' -- Zoho reserves that keyword. |

## Term — `terms`

An academic term/session. Classes and enrollments are scoped to one.

SQL table `terms` · Zoho module `Terms` (create)

| Field | Type | Req | Unique | SQL column | Notes |
|---|---|:-:|:-:|---|---|
| `name` | text | ✓ |  | `name` | e.g. '2026 Term 1' |
| `term_code` | text | ✓ | ✓ | `term_code` | e.g. '2026T1' |
| `academic_year` | integer | ✓ |  | `academic_year` |  |
| `sequence_no` | integer |  |  | `sequence_no` | Order within the academic year: 1, 2, 3... |
| `start_date` | date | ✓ |  | `start_date` |  |
| `end_date` | date | ✓ |  | `end_date` |  |
| `enrollment_opens` | date |  |  | `enrollment_opens` |  |
| `enrollment_closes` | date |  |  | `enrollment_closes` |  |
| `status` | enum `term_status` | ✓ |  | `status` | default `Planned` |

**Constraints**

- `term_dates_ordered` — check `end_date >= start_date`

## Program — `programs`

SQL table `programs` · Zoho module `Academic_Programs` (create)

| Field | Type | Req | Unique | SQL column | Notes |
|---|---|:-:|:-:|---|---|
| `name` | text | ✓ |  | `name` |  |
| `program_code` | text | ✓ | ✓ | `program_code` |  |
| `description` | textarea |  |  | `description` |  |
| `level` | enum `academic_level` |  |  | `level` |  |
| `duration_terms` | integer |  |  | `duration_terms` |  |
| `status` | enum `catalog_status` | ✓ |  | `status` | default `Active` |
| `courses_count` | rollup(count of `courses`) |  |  | _(view)_ |  |

## Course — `courses`

What is taught. A course has no date and no teacher -- that is a `classes` row. The Zoho module name is forced by the target org: demo3 already holds an unrelated `Courses` (CustomModule2).

SQL table `courses` · Zoho module `Course_Catalog` (create)

| Field | Type | Req | Unique | SQL column | Notes |
|---|---|:-:|:-:|---|---|
| `name` | text | ✓ |  | `name` |  |
| `course_code` | text | ✓ | ✓ | `course_code` |  |
| `program` | reference → `programs` |  |  | `program_id` |  |
| `description` | textarea |  |  | `description` |  |
| `level` | enum `academic_level` |  |  | `level` |  |
| `contact_hours` | decimal |  |  | `contact_hours` |  |
| `default_capacity` | integer |  |  | `default_capacity` | default `20` |
| `default_fee` | currency |  |  | `default_fee` |  |
| `status` | enum `catalog_status` | ✓ |  | `status` | default `Active` |

## Admission — `admissions`

An application. Applicant details are held inline because no student row exists until the application is accepted; `student` is back-filled then.

SQL table `admissions` · Zoho module `Admissions` (create)

| Field | Type | Req | Unique | SQL column | Notes |
|---|---|:-:|:-:|---|---|
| `name` | text | ✓ |  | `name` | Zoho stock display field -- always text, so it cannot BE the auto-number. Workflow-composed from application_no. |
| `application_no` | autonumber |  | ✓ | `application_no` |  |
| `applicant_first_name` | text | ✓ |  | `applicant_first_name` |  |
| `applicant_last_name` | text | ✓ |  | `applicant_last_name` |  |
| `applicant_date_of_birth` | date |  |  | `applicant_date_of_birth` |  |
| `applicant_gender` | enum `gender` |  |  | `applicant_gender` |  |
| `guardian_name` | text |  |  | `guardian_name` |  |
| `guardian_phone` | phone |  |  | `guardian_phone` |  |
| `guardian_email` | email |  |  | `guardian_email` |  |
| `household` | reference → `households` |  |  | `household_id` | Linked once an existing family is matched, or created on acceptance. |
| `student` | reference → `students` |  |  | `student_id` | Back-filled when the application is accepted. |
| `term` | reference → `terms` | ✓ |  | `term_id` |  |
| `program` | reference → `programs` |  |  | `program_id` |  |
| `source` | enum `admission_source` |  |  | `source` |  |
| `stage` | enum `admission_stage` | ✓ |  | `stage` | default `Enquiry` |
| `applied_date` | date | ✓ |  | `applied_date` |  |
| `interview_date` | datetime |  |  | `interview_date` |  |
| `decision_date` | date |  |  | `decision_date` |  |
| `decision_by` | user_reference |  |  | `decision_by_id` |  |
| `rejection_reason` | textarea |  |  | `rejection_reason` |  |
| `notes` | textarea |  |  | `notes` | api_name is not 'Notes' -- Zoho reserves that keyword. |

## Class — `classes`

A section/batch: course x term x weekly timetable. NOT a dated lesson -- that is `class_sessions`. Attendance never attaches here.

SQL table `classes` · Zoho module `Classes` (create)

| Field | Type | Req | Unique | SQL column | Notes |
|---|---|:-:|:-:|---|---|
| `name` | text | ✓ |  | `name` | e.g. 'MATH101 - 2026T1 - A' |
| `class_code` | text | ✓ | ✓ | `class_code` |  |
| `course` | reference → `courses` | ✓ |  | `course_id` |  |
| `term` | reference → `terms` | ✓ |  | `term_id` |  |
| `section_label` | text |  |  | `section_label` | e.g. 'A', 'B', 'Evening' |
| `primary_teacher` | reference → `teachers` |  |  | `primary_teacher_id` |  |
| `room` | text |  |  | `room` |  |
| `capacity` | integer | ✓ |  | `capacity` | default `20` |
| `meeting_days` | multi_enum `weekday` |  |  | `meeting_days` | The weekly pattern that class_sessions rows are generated from. |
| `start_time` | time |  |  | `start_time` |  |
| `end_time` | time |  |  | `end_time` |  |
| `start_date` | date | ✓ |  | `start_date` |  |
| `end_date` | date | ✓ |  | `end_date` |  |
| `status` | enum `class_status` | ✓ |  | `status` | default `Draft` |
| `enrolled_count` | rollup(count of `enrollments`) |  |  | _(view)_ |  |
| `sessions_count` | rollup(count of `class_sessions`) |  |  | _(view)_ |  |

**Constraints**

- `class_dates_ordered` — check `end_date >= start_date`
- `class_capacity_positive` — check `capacity > 0`

## Class Session — `class_sessions`

A single dated meeting of a class, generated from the weekly pattern on `classes`. teacher_taken records who actually ran it, which may differ from the class primary_teacher (substitutions).

SQL table `class_sessions` · Zoho module `Class_Sessions` (create)

| Field | Type | Req | Unique | SQL column | Notes |
|---|---|:-:|:-:|---|---|
| `name` | text | ✓ |  | `name` | Auto-composed: '<class_code> - <session_date>' |
| `class` | reference → `classes` | ✓ |  | `class_id` |  |
| `session_date` | date | ✓ |  | `session_date` |  |
| `start_time` | time |  |  | `start_time` |  |
| `end_time` | time |  |  | `end_time` |  |
| `sequence_no` | integer |  |  | `sequence_no` | 1-based ordinal within the class. |
| `teacher_taken` | reference → `teachers` |  |  | `teacher_taken_id` |  |
| `status` | enum `session_status` | ✓ |  | `status` | default `Scheduled` |
| `topic` | text |  |  | `topic` |  |
| `notes` | textarea |  |  | `notes` | api_name is not 'Notes' -- Zoho reserves that keyword. |
| `attendance_taken` | boolean |  |  | `attendance_taken` | default `false` |
| `attendance_taken_at` | datetime |  |  | `attendance_taken_at` |  |
| `present_count` | rollup(count of `attendance`) |  |  | _(view)_ |  |
| `absent_count` | rollup(count of `attendance`) |  |  | _(view)_ |  |

**Constraints**

- `uq_session_per_class_date` — unique (class, session_date, start_time)

## Enrollment — `enrollments`

Joins a student to a class. `course` and `term` are intentionally denormalized: Zoho COQL cannot join two hops, so "all enrollments in Term 1" is only answerable if the term sits on this record. Both are derived from `class` and kept in step by workflow (Zoho) / trigger (SQL).

SQL table `enrollments` · Zoho module `Enrollments` (create)

| Field | Type | Req | Unique | SQL column | Notes |
|---|---|:-:|:-:|---|---|
| `name` | text | ✓ |  | `name` | Zoho stock display field -- always text, so it cannot BE the auto-number. Workflow-composed from enrollment_no. |
| `enrollment_no` | autonumber |  | ✓ | `enrollment_no` |  |
| `student` | reference → `students` | ✓ |  | `student_id` |  |
| `class` | reference → `classes` | ✓ |  | `class_id` |  |
| `course` | reference → `courses` |  |  | `course_id` | derived from `class.course` |
| `term` | reference → `terms` |  |  | `term_id` | derived from `class.term` |
| `status` | enum `enrollment_status` | ✓ |  | `status` | default `Pending` |
| `enrolled_on` | date | ✓ |  | `enrolled_on` |  |
| `dropped_on` | date |  |  | `dropped_on` |  |
| `drop_reason` | textarea |  |  | `drop_reason` |  |
| `fee_amount` | currency |  |  | `fee_amount` |  |
| `discount` | currency |  |  | `discount` | default `0` |
| `payment_status` | enum `payment_status` |  |  | `payment_status` | default `Unpaid` |
| `final_grade` | text |  |  | `final_grade` |  |
| `attendance_rate` | rollup(percent of `attendance`) |  |  | _(view)_ |  |

**Constraints**

- `uq_enrollment_student_class` — unique (student, class) — Zoho has no composite unique field -- enforced by validation rule. See docs/zoho-mapping.md.

## Allocation — `allocations`

Teacher assigned to a class. class_session is NULL for a whole-term allocation and set only for a one-off substitution on that date.

SQL table `allocations` · Zoho module `Allocations` (create)

| Field | Type | Req | Unique | SQL column | Notes |
|---|---|:-:|:-:|---|---|
| `name` | text | ✓ |  | `name` | Zoho stock display field -- always text, so it cannot BE the auto-number. Workflow-composed from allocation_no. |
| `allocation_no` | autonumber |  | ✓ | `allocation_no` |  |
| `teacher` | reference → `teachers` | ✓ |  | `teacher_id` |  |
| `class` | reference → `classes` | ✓ |  | `class_id` |  |
| `class_session` | reference → `class_sessions` |  |  | `class_session_id` | NULL = allocation covers the whole class. Set = single-session substitution. |
| `role` | enum `allocation_role` | ✓ |  | `role` | default `Lead Teacher` |
| `effective_from` | date |  |  | `effective_from` |  |
| `effective_to` | date |  |  | `effective_to` |  |
| `status` | enum `allocation_status` | ✓ |  | `status` | default `Planned` |
| `notes` | textarea |  |  | `notes` | api_name is not 'Notes' -- Zoho reserves that keyword. |

**Constraints**

- `allocation_dates_ordered` — check `effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from`

## Attendance — `attendance`

One mark per enrolled student per session. `student` and `class` are denormalized off the enrollment for the same COQL reason as enrollments. Highest-volume table: students x classes-each x sessions-per-term.

SQL table `attendance` · Zoho module `Attendance` (create)

| Field | Type | Req | Unique | SQL column | Notes |
|---|---|:-:|:-:|---|---|
| `name` | text | ✓ |  | `name` | Zoho stock display field -- always text, so it cannot BE the auto-number. Workflow-composed from attendance_no. |
| `attendance_no` | autonumber |  | ✓ | `attendance_no` |  |
| `class_session` | reference → `class_sessions` | ✓ |  | `class_session_id` |  |
| `enrollment` | reference → `enrollments` | ✓ |  | `enrollment_id` |  |
| `student` | reference → `students` | ✓ |  | `student_id` | derived from `enrollment.student` |
| `class` | reference → `classes` | ✓ |  | `class_id` | derived from `enrollment.class` |
| `status` | enum `attendance_status` | ✓ |  | `status` | default `Present` |
| `minutes_late` | integer |  |  | `minutes_late` | default `0` |
| `marked_by` | reference → `teachers` |  |  | `marked_by_id` | The teacher who took the class and recorded the mark. |
| `marked_at` | datetime |  |  | `marked_at` |  |
| `remarks` | textarea |  |  | `remarks` |  |

**Constraints**

- `uq_attendance_enrollment_session` — unique (enrollment, class_session) — Zoho: enforced by validation rule, not a native composite unique.
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
- `admission_stage` — `Enquiry`, `Application Submitted`, `Documents Pending`, `Interview`, `Offered`, `Accepted`, `Enrolled`, `Rejected`, `Withdrawn`
- `admission_source` — `Walk In`, `Website`, `Referral`, `Social Media`, `Agent`, `Event`, `Other`
- `class_status` — `Draft`, `Scheduled`, `Running`, `Completed`, `Cancelled`
- `weekday` — `Monday`, `Tuesday`, `Wednesday`, `Thursday`, `Friday`, `Saturday`, `Sunday`
- `session_status` — `Scheduled`, `Held`, `Cancelled`, `Rescheduled`, `Makeup`
- `enrollment_status` — `Pending`, `Active`, `Completed`, `Dropped`, `Transferred`
- `payment_status` — `Unpaid`, `Partially Paid`, `Paid`, `Waived`, `Refunded`
- `allocation_role` — `Lead Teacher`, `Assistant`, `Substitute`, `Observer`
- `allocation_status` — `Planned`, `Active`, `Ended`, `Cancelled`
- `attendance_status` — `Present`, `Absent`, `Late`, `Excused`, `Left Early`
