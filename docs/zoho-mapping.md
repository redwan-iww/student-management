# Zoho CRM Mapping

<!-- GENERATED FILE -- do not edit. Source: schema/model.yaml (npm run gen:docs) -->

The contract between the canonical model and the CRM. `getFields` on a live
module must agree with the `Zoho api_name` column here — that diff is the
drift check.

## Module map

| Entity | Zoho module | Strategy | Notes |
|---|---|---|---|
| `households` | `Contacts` | extend_standard |  |
| `students` | `Students` | extend_custom | CustomModule45 (id 4731441000029976123) in demo3: status visible, custom, api-supported, stock system fields only. Re-verified 2026-09-19. |
| `teachers` | `Teachers` | create |  |
| `terms` | `Terms` | create |  |
| `programs` | `Academic_Programs` | create | Zoho rejects "Program"/"Programs" as a module name -- "You cannot have a module name that matches a system keyword" (hit 2026-09-19 creating this module in demo3). Both the labels and the api_name have to change, unlike Course_Catalog where only the api_name did. The canonical entity stays `programs` and SQL/TypeScript are unaffected. |
| `courses` | `Course_Catalog` | create | api_name is Course_Catalog, not Courses: CustomModule2 already holds the Courses api_name. Audited 2026-09-14 and re-verified 2026-09-19 against demo3 (id 4731441000000553422) -- that module is status user_hidden and COQL returns NO_PERMISSION, so it can be neither read nor safely reused. User-facing labels stay Course / Courses. |
| `admissions` | `Admissions` | create |  |
| `classes` | `Classes` | create |  |
| `class_sessions` | `Class_Sessions` | create |  |
| `enrollments` | `Enrollments` | create |  |
| `allocations` | `Allocations` | create |  |
| `attendance` | `Attendance` | create |  |

Strategies: `extend_standard` = stock Zoho module, add custom fields only ·
`extend_custom` = custom module already in the org · `create` = must be created.

## Field map

### Contacts — `households`

| Field | Zoho api_name | Zoho data_type | Stock? |
|---|---|---|:-:|
| `household_name` | `Last_Name` | text | ✓ |
| `household_code` | `Household_Code` | autonumber |  |
| `primary_guardian_name` | `Primary_Guardian_Name` | text |  |
| `primary_guardian_relationship` | `Primary_Guardian_Relationship` | picklist |  |
| `email` | `Email` | email | ✓ |
| `phone` | `Phone` | phone | ✓ |
| `mobile` | `Mobile` | phone | ✓ |
| `secondary_guardian_name` | `Secondary_Guardian_Name` | text |  |
| `secondary_guardian_relationship` | `Secondary_Guardian_Relationship` | picklist |  |
| `secondary_guardian_phone` | `Secondary_Guardian_Phone` | phone |  |
| `secondary_guardian_email` | `Secondary_Guardian_Email` | email |  |
| `preferred_contact_method` | `Preferred_Contact_Method` | picklist |  |
| `address_line` | `Mailing_Street` | text | ✓ |
| `city` | `Mailing_City` | text | ✓ |
| `postcode` | `Mailing_Zip` | text | ✓ |
| `country` | `Mailing_Country` | text | ✓ |
| `billing_status` | `Billing_Status` | picklist |  |
| `notes` | `Household_Notes` | textarea |  |
| `active_students_count` | `Active_Students_Count` | rollup summary |  |

### Students — `students`

| Field | Zoho api_name | Zoho data_type | Stock? |
|---|---|---|:-:|
| `full_name` | `Name` | text | ✓ |
| `student_code` | `Student_Code` | autonumber |  |
| `household` | `Household` | lookup → `Contacts` |  |
| `first_name` | `First_Name` | text |  |
| `last_name` | `Last_Name` | text |  |
| `date_of_birth` | `Date_Of_Birth` | date |  |
| `gender` | `Gender` | picklist |  |
| `status` | `Status` | picklist |  |
| `email` | `Email` | email | ✓ |
| `phone` | `Phone` | phone |  |
| `enrollment_date` | `Enrollment_Date` | date |  |
| `exit_date` | `Exit_Date` | date |  |
| `emergency_contact_name` | `Emergency_Contact_Name` | text |  |
| `emergency_contact_phone` | `Emergency_Contact_Phone` | phone |  |
| `medical_notes` | `Medical_Notes` | textarea |  |
| `photo` | `Record_Image` | profileimage | ✓ |
| `active_enrollments_count` | `Active_Enrollments_Count` | rollup summary |  |

### Teachers — `teachers`

| Field | Zoho api_name | Zoho data_type | Stock? |
|---|---|---|:-:|
| `full_name` | `Name` | text | ✓ |
| `staff_code` | `Staff_Code` | autonumber |  |
| `email` | `Email` | email | ✓ |
| `phone` | `Phone` | phone |  |
| `crm_user` | `CRM_User` | userlookup |  |
| `employment_type` | `Employment_Type` | picklist |  |
| `specialisms` | `Specialisms` | multiselectpicklist |  |
| `status` | `Status` | picklist |  |
| `joined_on` | `Joined_On` | date |  |
| `notes` | `Teacher_Notes` | textarea |  |

### Terms — `terms`

| Field | Zoho api_name | Zoho data_type | Stock? |
|---|---|---|:-:|
| `name` | `Name` | text | ✓ |
| `term_code` | `Term_Code` | text |  |
| `academic_year` | `Academic_Year` | integer |  |
| `sequence_no` | `Sequence_No` | integer |  |
| `start_date` | `Start_Date` | date |  |
| `end_date` | `End_Date` | date |  |
| `enrollment_opens` | `Enrollment_Opens` | date |  |
| `enrollment_closes` | `Enrollment_Closes` | date |  |
| `status` | `Status` | picklist |  |

### Academic_Programs — `programs`

| Field | Zoho api_name | Zoho data_type | Stock? |
|---|---|---|:-:|
| `name` | `Name` | text | ✓ |
| `program_code` | `Program_Code` | text |  |
| `description` | `Description` | textarea |  |
| `level` | `Level` | picklist |  |
| `duration_terms` | `Duration_Terms` | integer |  |
| `status` | `Status` | picklist |  |
| `courses_count` | `Courses_Count` | rollup summary |  |

### Course_Catalog — `courses`

| Field | Zoho api_name | Zoho data_type | Stock? |
|---|---|---|:-:|
| `name` | `Name` | text | ✓ |
| `course_code` | `Course_Code` | text |  |
| `program` | `Program` | lookup → `Academic_Programs` |  |
| `description` | `Description` | textarea |  |
| `level` | `Level` | picklist |  |
| `contact_hours` | `Contact_Hours` | double |  |
| `default_capacity` | `Default_Capacity` | integer |  |
| `default_fee` | `Default_Fee` | currency |  |
| `status` | `Status` | picklist |  |

### Admissions — `admissions`

| Field | Zoho api_name | Zoho data_type | Stock? |
|---|---|---|:-:|
| `name` | `Name` | text | ✓ |
| `application_no` | `Application_No` | autonumber |  |
| `applicant_first_name` | `Applicant_First_Name` | text |  |
| `applicant_last_name` | `Applicant_Last_Name` | text |  |
| `applicant_date_of_birth` | `Applicant_Date_Of_Birth` | date |  |
| `applicant_gender` | `Applicant_Gender` | picklist |  |
| `guardian_name` | `Guardian_Name` | text |  |
| `guardian_phone` | `Guardian_Phone` | phone |  |
| `guardian_email` | `Guardian_Email` | email |  |
| `household` | `Household` | lookup → `Contacts` |  |
| `student` | `Student` | lookup → `Students` |  |
| `term` | `Term` | lookup → `Terms` |  |
| `program` | `Program` | lookup → `Academic_Programs` |  |
| `source` | `Source` | picklist |  |
| `stage` | `Stage` | picklist |  |
| `applied_date` | `Applied_Date` | date |  |
| `interview_date` | `Interview_Date` | datetime |  |
| `decision_date` | `Decision_Date` | date |  |
| `decision_by` | `Decision_By` | userlookup |  |
| `rejection_reason` | `Rejection_Reason` | textarea |  |
| `notes` | `Admission_Notes` | textarea |  |

### Classes — `classes`

| Field | Zoho api_name | Zoho data_type | Stock? |
|---|---|---|:-:|
| `name` | `Name` | text | ✓ |
| `class_code` | `Class_Code` | text |  |
| `course` | `Course` | lookup → `Course_Catalog` |  |
| `term` | `Term` | lookup → `Terms` |  |
| `section_label` | `Section_Label` | text |  |
| `primary_teacher` | `Primary_Teacher` | lookup → `Teachers` |  |
| `room` | `Room` | text |  |
| `capacity` | `Capacity` | integer |  |
| `meeting_days` | `Meeting_Days` | multiselectpicklist |  |
| `start_time` | `Start_Time` | text (HH:MM — Zoho has no time type) |  |
| `end_time` | `End_Time` | text (HH:MM — Zoho has no time type) |  |
| `start_date` | `Start_Date` | date |  |
| `end_date` | `End_Date` | date |  |
| `status` | `Status` | picklist |  |
| `enrolled_count` | `Enrolled_Count` | rollup summary |  |
| `sessions_count` | `Sessions_Count` | rollup summary |  |

### Class_Sessions — `class_sessions`

| Field | Zoho api_name | Zoho data_type | Stock? |
|---|---|---|:-:|
| `name` | `Name` | text | ✓ |
| `class` | `Class` | lookup → `Classes` |  |
| `session_date` | `Session_Date` | date |  |
| `start_time` | `Start_Time` | text (HH:MM — Zoho has no time type) |  |
| `end_time` | `End_Time` | text (HH:MM — Zoho has no time type) |  |
| `sequence_no` | `Sequence_No` | integer |  |
| `teacher_taken` | `Teacher_Taken` | lookup → `Teachers` |  |
| `status` | `Status` | picklist |  |
| `topic` | `Topic` | text |  |
| `notes` | `Session_Notes` | textarea |  |
| `attendance_taken` | `Attendance_Taken` | boolean |  |
| `attendance_taken_at` | `Attendance_Taken_At` | datetime |  |
| `present_count` | `Present_Count` | rollup summary |  |
| `absent_count` | `Absent_Count` | rollup summary |  |

### Enrollments — `enrollments`

| Field | Zoho api_name | Zoho data_type | Stock? |
|---|---|---|:-:|
| `name` | `Name` | text | ✓ |
| `enrollment_no` | `Enrollment_No` | autonumber |  |
| `student` | `Student` | lookup → `Students` |  |
| `class` | `Class` | lookup → `Classes` |  |
| `course` | `Course` | lookup → `Course_Catalog` |  |
| `term` | `Term` | lookup → `Terms` |  |
| `status` | `Status` | picklist |  |
| `enrolled_on` | `Enrolled_On` | date |  |
| `dropped_on` | `Dropped_On` | date |  |
| `drop_reason` | `Drop_Reason` | textarea |  |
| `fee_amount` | `Fee_Amount` | currency |  |
| `discount` | `Discount` | currency |  |
| `payment_status` | `Payment_Status` | picklist |  |
| `final_grade` | `Final_Grade` | text |  |
| `attendance_rate` | `Attendance_Rate` | rollup summary |  |

### Allocations — `allocations`

| Field | Zoho api_name | Zoho data_type | Stock? |
|---|---|---|:-:|
| `name` | `Name` | text | ✓ |
| `allocation_no` | `Allocation_No` | autonumber |  |
| `teacher` | `Teacher` | lookup → `Teachers` |  |
| `class` | `Class` | lookup → `Classes` |  |
| `class_session` | `Class_Session` | lookup → `Class_Sessions` |  |
| `role` | `Role` | picklist |  |
| `effective_from` | `Effective_From` | date |  |
| `effective_to` | `Effective_To` | date |  |
| `status` | `Status` | picklist |  |
| `notes` | `Allocation_Notes` | textarea |  |

### Attendance — `attendance`

| Field | Zoho api_name | Zoho data_type | Stock? |
|---|---|---|:-:|
| `name` | `Name` | text | ✓ |
| `attendance_no` | `Attendance_No` | autonumber |  |
| `class_session` | `Class_Session` | lookup → `Class_Sessions` |  |
| `enrollment` | `Enrollment` | lookup → `Enrollments` |  |
| `student` | `Student` | lookup → `Students` |  |
| `class` | `Class` | lookup → `Classes` |  |
| `status` | `Status` | picklist |  |
| `minutes_late` | `Minutes_Late` | integer |  |
| `marked_by` | `Marked_By` | lookup → `Teachers` |  |
| `marked_at` | `Marked_At` | datetime |  |
| `remarks` | `Remarks` | textarea |  |

## Things Zoho cannot express natively

- **Check** `Terms`.`term_dates_ordered` — `end_date >= start_date` — implement as a Zoho validation rule.
- **Check** `Classes`.`class_dates_ordered` — `end_date >= start_date` — implement as a Zoho validation rule.
- **Check** `Classes`.`class_capacity_positive` — `capacity > 0` — implement as a Zoho validation rule.
- **Time-only field** `Classes`.`Start_Time` — stored as `HH:MM` text.
- **Time-only field** `Classes`.`End_Time` — stored as `HH:MM` text.
- **Composite unique** `Class_Sessions` (class + session_date + start_time) — no native composite unique field. Enforce with a custom function that COQL-counts matches on create/edit and rejects when > 0.
- **Time-only field** `Class_Sessions`.`Start_Time` — stored as `HH:MM` text.
- **Time-only field** `Class_Sessions`.`End_Time` — stored as `HH:MM` text.
- **Composite unique** `Enrollments` (student + class) — no native composite unique field. Enforce with a custom function that COQL-counts matches on create/edit and rejects when > 0.
- **Ratio rollup** `Enrollments`.`Attendance_Rate` — Zoho rollups cannot divide. Create numerator and denominator count rollups plus a formula field.
- **Denormalized field** `Enrollments`.`Course` — copied from `class.course`. Keep in step with a workflow field-update on create/edit (Postgres does this with a trigger).
- **Denormalized field** `Enrollments`.`Term` — copied from `class.term`. Keep in step with a workflow field-update on create/edit (Postgres does this with a trigger).
- **Check** `Allocations`.`allocation_dates_ordered` — `effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from` — implement as a Zoho validation rule.
- **Composite unique** `Attendance` (enrollment + class_session) — no native composite unique field. Enforce with a custom function that COQL-counts matches on create/edit and rejects when > 0.
- **Check** `Attendance`.`attendance_minutes_late_nonneg` — `minutes_late >= 0` — implement as a Zoho validation rule.
- **Denormalized field** `Attendance`.`Student` — copied from `enrollment.student`. Keep in step with a workflow field-update on create/edit (Postgres does this with a trigger).
- **Denormalized field** `Attendance`.`Class` — copied from `enrollment.class`. Keep in step with a workflow field-update on create/edit (Postgres does this with a trigger).

## Build order

Lookups need their target module to exist, so modules are created in this order:

```
Contacts
  -> Students
  -> Teachers
  -> Terms
  -> Academic_Programs
  -> Course_Catalog
  -> Admissions
  -> Classes
  -> Class_Sessions
  -> Enrollments
  -> Allocations
  -> Attendance
```
