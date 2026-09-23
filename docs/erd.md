# Entity Relationship Diagram

<!-- GENERATED FILE -- do not edit. Source: schema/model.yaml (npm run gen:docs) -->

Crow's feet point at the many side. `o|` marks an optional reference.

```mermaid
erDiagram
    HOUSEHOLDS {
        text household_name "required"
        autonumber household_code "unique"
        text primary_guardian_name "required"
        enum primary_guardian_relationship
        email email
        phone phone
        phone mobile
        text secondary_guardian_name
        enum secondary_guardian_relationship
        phone secondary_guardian_phone
        email secondary_guardian_email
        enum preferred_contact_method
        text address_line
        text city
        text postcode
        text country
        enum billing_status
        textarea notes
    }
    STUDENTS {
        text full_name "required"
        autonumber student_code "unique"
        FK_households household "required"
        text first_name "required"
        text last_name "required"
        date date_of_birth
        enum gender
        enum status "required"
        email email
        phone phone
        date enrollment_date
        date exit_date
        text emergency_contact_name
        phone emergency_contact_phone
        textarea medical_notes
        image photo
    }
    TEACHERS {
        text full_name "required"
        autonumber staff_code "unique"
        email email "unique"
        phone phone
        user_reference crm_user
        enum employment_type
        multi_enum specialisms
        enum status "required"
        date joined_on
        textarea notes
    }
    TERMS {
        text name "required"
        text term_code "required,unique"
        integer academic_year "required"
        integer sequence_no
        date start_date "required"
        date end_date "required"
        date enrollment_opens
        date enrollment_closes
        enum status "required"
    }
    HOLIDAYS {
        text name "required"
        date start_date "required"
        date end_date
        FK_terms term
        enum kind "required"
        textarea notes
    }
    PROGRAMS {
        text name "required"
        text program_code "required,unique"
        textarea description
        enum level
        integer duration_terms
        enum status "required"
    }
    COURSES {
        text name "required"
        text course_code "required,unique"
        FK_programs program
        textarea description
        enum level
        decimal contact_hours
        integer default_capacity
        currency default_fee
        enum status "required"
    }
    ADMISSIONS {
        text name "required"
        autonumber application_no "unique"
        text applicant_first_name "required"
        text applicant_last_name "required"
        date applicant_date_of_birth
        enum applicant_gender
        text guardian_name
        phone guardian_phone
        email guardian_email
        FK_households household
        FK_students student
        FK_terms term "required"
        FK_programs program
        enum source
        enum stage "required"
        date applied_date "required"
        datetime interview_date
        date decision_date
        user_reference decision_by
        textarea rejection_reason
        textarea notes
    }
    CLASSES {
        text name "required"
        text class_code "required,unique"
        FK_courses course "required"
        FK_terms term "required"
        text section_label
        FK_teachers primary_teacher
        text room
        integer capacity "required"
        multi_enum meeting_days
        time start_time
        time end_time
        date start_date "required"
        date end_date "required"
        enum status "required"
    }
    CLASS_SESSIONS {
        text name "required"
        FK_classes class "required"
        date session_date "required"
        time start_time
        time end_time
        integer sequence_no
        FK_teachers teacher_taken
        enum status "required"
        text topic
        textarea notes
        boolean attendance_taken
        datetime attendance_taken_at
    }
    ENROLLMENTS {
        text name "required"
        autonumber enrollment_no "unique"
        FK_students student "required"
        FK_classes class "required"
        FK_courses course
        FK_terms term
        enum status "required"
        date enrolled_on "required"
        date dropped_on
        textarea drop_reason
        currency fee_amount
        currency discount
        enum payment_status
        text final_grade
    }
    ALLOCATIONS {
        text name "required"
        autonumber allocation_no "unique"
        FK_teachers teacher "required"
        FK_classes class "required"
        FK_class_sessions class_session
        enum role "required"
        date effective_from
        date effective_to
        enum status "required"
        textarea notes
    }
    ATTENDANCE {
        text name "required"
        autonumber attendance_no "unique"
        FK_class_sessions class_session "required"
        FK_enrollments enrollment "required"
        FK_students student "required"
        FK_classes class "required"
        enum status "required"
        integer minutes_late
        FK_teachers marked_by
        datetime marked_at
        textarea remarks
    }

    HOUSEHOLDS ||--o{ STUDENTS : "household"
    TERMS |o--o{ HOLIDAYS : "term"
    PROGRAMS |o--o{ COURSES : "program"
    HOUSEHOLDS |o--o{ ADMISSIONS : "household"
    STUDENTS |o--o{ ADMISSIONS : "student"
    TERMS ||--o{ ADMISSIONS : "term"
    PROGRAMS |o--o{ ADMISSIONS : "program"
    COURSES ||--o{ CLASSES : "course"
    TERMS ||--o{ CLASSES : "term"
    TEACHERS |o--o{ CLASSES : "primary_teacher"
    CLASSES ||--o{ CLASS_SESSIONS : "class"
    TEACHERS |o--o{ CLASS_SESSIONS : "teacher_taken"
    STUDENTS ||--o{ ENROLLMENTS : "student"
    CLASSES ||--o{ ENROLLMENTS : "class"
    COURSES |o--o{ ENROLLMENTS : "course"
    TERMS |o--o{ ENROLLMENTS : "term"
    TEACHERS ||--o{ ALLOCATIONS : "teacher"
    CLASSES ||--o{ ALLOCATIONS : "class"
    CLASS_SESSIONS |o--o{ ALLOCATIONS : "class_session"
    CLASS_SESSIONS ||--o{ ATTENDANCE : "class_session"
    ENROLLMENTS ||--o{ ATTENDANCE : "enrollment"
    STUDENTS ||--o{ ATTENDANCE : "student"
    CLASSES ||--o{ ATTENDANCE : "class"
    TEACHERS |o--o{ ATTENDANCE : "marked_by"
```

## Reading the model

- **Household** (`households`) — Family or billing unit. In Zoho this rides on the stock Contacts module, so one record is "the household plus its primary guardian". The entity is kept distinct in this spec so a future move to Accounts-as-household is a mapping change, not a remodel.
- **Student** (`students`) — The learner. Always belongs to exactly one household.
- **Teacher** (`teachers`) — Teaching staff. A separate module rather than CRM users because the org holds only 2 user licences; crm_user links the minority who do have one.
- **Term** (`terms`) — An academic term/session. Classes and enrollments are scoped to one.
- **Holiday** (`holidays`) — A date or date range on which no lesson is held. Scoped to a term when it is a term-specific closure, or left unscoped to apply across the whole calendar -- which is what a public holiday needs.
- **Course** (`courses`) — What is taught. A course has no date and no teacher -- that is a `classes` row. The Zoho module name is forced by the target org: demo3 already holds an unrelated `Courses` (CustomModule2).
- **Admission** (`admissions`) — An application. Applicant details are held inline because no student row exists until the application is accepted; `student` is back-filled then.
- **Class** (`classes`) — A section/batch: course x term x weekly timetable. NOT a dated lesson -- that is `class_sessions`. Attendance never attaches here.
- **Class Session** (`class_sessions`) — A single dated meeting of a class, generated from the weekly pattern on `classes`. teacher_taken records who actually ran it, which may differ from the class primary_teacher (substitutions).
- **Enrollment** (`enrollments`) — Joins a student to a class. `course` and `term` are intentionally denormalized: Zoho COQL cannot join two hops, so "all enrollments in Term 1" is only answerable if the term sits on this record. Both are derived from `class` and kept in step by workflow (Zoho) / trigger (SQL).
- **Allocation** (`allocations`) — Teacher assigned to a class. class_session is NULL for a whole-term allocation and set only for a one-off substitution on that date.
- **Attendance** (`attendance`) — One mark per enrolled student per session. `student` and `class` are denormalized off the enrollment for the same COQL reason as enrollments. Highest-volume table: students x classes-each x sessions-per-term.
