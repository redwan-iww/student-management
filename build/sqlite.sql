-- GENERATED FILE -- do not edit.
-- Source: schema/model.yaml + schema/enums.yaml   (npm run gen:sqlite)
--
-- SQLite dialect. See build/postgres.sql for the Supabase/Postgres form.

-- Off by default in SQLite, and every ON DELETE rule below depends on it.
PRAGMA foreign_keys = ON;

BEGIN;

-- ---------------------------------------------------------------------------
-- Auto-number counters (SQLite has no sequences)
-- ---------------------------------------------------------------------------

CREATE TABLE "_counters" (
  "name" TEXT PRIMARY KEY,
  "value" INTEGER NOT NULL DEFAULT 0
);

INSERT INTO "_counters" ("name", "value") VALUES ('households_household_code', 0);
INSERT INTO "_counters" ("name", "value") VALUES ('students_student_code', 0);
INSERT INTO "_counters" ("name", "value") VALUES ('teachers_staff_code', 0);
INSERT INTO "_counters" ("name", "value") VALUES ('admissions_application_no', 0);
INSERT INTO "_counters" ("name", "value") VALUES ('enrollments_enrollment_no', 0);
INSERT INTO "_counters" ("name", "value") VALUES ('allocations_allocation_no', 0);
INSERT INTO "_counters" ("name", "value") VALUES ('attendance_attendance_no', 0);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Family or billing unit. In Zoho this rides on the stock Contacts module, so one record is "the household plus its primary guardian". The entity is kept distinct in this spec so a future move to Accounts-as-household is a mapping change, not a remodel.
CREATE TABLE "households" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "household_name" TEXT NOT NULL
  -- household_name: Stock Zoho display field. Holds e.g. 'Rahman Family'.
,  "household_code" TEXT UNIQUE,
  "primary_guardian_name" TEXT NOT NULL,
  "primary_guardian_relationship" TEXT CHECK ("primary_guardian_relationship" IS NULL OR "primary_guardian_relationship" IN ('Mother', 'Father', 'Grandparent', 'Legal Guardian', 'Sibling', 'Other')),
  "email" TEXT,
  "phone" TEXT,
  "mobile" TEXT,
  "secondary_guardian_name" TEXT,
  "secondary_guardian_relationship" TEXT CHECK ("secondary_guardian_relationship" IS NULL OR "secondary_guardian_relationship" IN ('Mother', 'Father', 'Grandparent', 'Legal Guardian', 'Sibling', 'Other')),
  "secondary_guardian_phone" TEXT,
  "secondary_guardian_email" TEXT,
  "preferred_contact_method" TEXT DEFAULT 'Email' CHECK ("preferred_contact_method" IS NULL OR "preferred_contact_method" IN ('Email', 'Phone', 'SMS', 'WhatsApp')),
  "address_line" TEXT
  -- address_line: Zoho stock Mailing_Street is text, not textarea.
,  "city" TEXT,
  "postcode" TEXT,
  "country" TEXT,
  "billing_status" TEXT DEFAULT 'Current' CHECK ("billing_status" IS NULL OR "billing_status" IN ('Current', 'Overdue', 'On Hold', 'Closed')),
  "notes" TEXT
  -- notes: api_name is not 'Notes' -- Zoho reserves that keyword.
,  "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
  "updated_at" TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The learner. Always belongs to exactly one household.
CREATE TABLE "students" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "full_name" TEXT NOT NULL
  -- full_name: Stock display field. Keep in step with first_name + last_name.
,  "student_code" TEXT UNIQUE,
  "household_id" INTEGER NOT NULL REFERENCES "households" ("id") ON DELETE RESTRICT,
  "first_name" TEXT NOT NULL,
  "last_name" TEXT NOT NULL,
  "date_of_birth" TEXT,
  "gender" TEXT CHECK ("gender" IS NULL OR "gender" IN ('Male', 'Female', 'Other', 'Prefer Not To Say')),
  "status" TEXT NOT NULL DEFAULT 'Prospective' CHECK ("status" IS NULL OR "status" IN ('Prospective', 'Active', 'On Hold', 'Withdrawn', 'Graduated', 'Alumni')),
  "email" TEXT,
  "phone" TEXT,
  "enrollment_date" TEXT,
  "exit_date" TEXT,
  "emergency_contact_name" TEXT,
  "emergency_contact_phone" TEXT,
  "medical_notes" TEXT,
  "photo" TEXT,
  "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
  "updated_at" TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Teaching staff. A separate module rather than CRM users because the org holds only 2 user licences; crm_user links the minority who do have one.
CREATE TABLE "teachers" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "full_name" TEXT NOT NULL,
  "staff_code" TEXT UNIQUE,
  "email" TEXT UNIQUE
  -- email: Stock field: every Zoho custom module ships with Email + Secondary_Email. Creating it returns DUPLICATE_DATA (hit 2026-09-19 on Teachers).
,  "phone" TEXT,
  "crm_user_id" TEXT
  -- crm_user_id: Null for unlicensed staff. Set only when the teacher has a CRM seat.
,  "employment_type" TEXT CHECK ("employment_type" IS NULL OR "employment_type" IN ('Full Time', 'Part Time', 'Contract', 'Visiting')),
  "specialisms" TEXT CHECK ("specialisms" IS NULL OR json_valid("specialisms")),
  "status" TEXT NOT NULL DEFAULT 'Active' CHECK ("status" IS NULL OR "status" IN ('Active', 'On Leave', 'Inactive')),
  "joined_on" TEXT,
  "notes" TEXT
  -- notes: api_name is not 'Notes' -- Zoho reserves that keyword.
,  "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
  "updated_at" TEXT NOT NULL DEFAULT (datetime('now'))
);

-- An academic term/session. Classes and enrollments are scoped to one.
CREATE TABLE "terms" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT NOT NULL
  -- name: e.g. '2026 Term 1'
,  "term_code" TEXT NOT NULL UNIQUE
  -- term_code: e.g. '2026T1'
,  "academic_year" INTEGER NOT NULL,
  "sequence_no" INTEGER
  -- sequence_no: Order within the academic year: 1, 2, 3...
,  "start_date" TEXT NOT NULL,
  "end_date" TEXT NOT NULL,
  "enrollment_opens" TEXT,
  "enrollment_closes" TEXT,
  "status" TEXT NOT NULL DEFAULT 'Planned' CHECK ("status" IS NULL OR "status" IN ('Planned', 'Open', 'In Progress', 'Closed', 'Archived')),
  "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
  "updated_at" TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT "term_dates_ordered" CHECK (end_date >= start_date)
);

CREATE TABLE "programs" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT NOT NULL,
  "program_code" TEXT NOT NULL UNIQUE,
  "description" TEXT,
  "level" TEXT CHECK ("level" IS NULL OR "level" IN ('Foundation', 'Beginner', 'Intermediate', 'Advanced', 'Professional')),
  "duration_terms" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'Active' CHECK ("status" IS NULL OR "status" IN ('Draft', 'Active', 'Inactive', 'Retired')),
  "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
  "updated_at" TEXT NOT NULL DEFAULT (datetime('now'))
);

-- What is taught. A course has no date and no teacher -- that is a `classes` row. The Zoho module name is forced by the target org: demo3 already holds an unrelated `Courses` (CustomModule2).
CREATE TABLE "courses" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT NOT NULL,
  "course_code" TEXT NOT NULL UNIQUE,
  "program_id" INTEGER REFERENCES "programs" ("id") ON DELETE SET NULL,
  "description" TEXT,
  "level" TEXT CHECK ("level" IS NULL OR "level" IN ('Foundation', 'Beginner', 'Intermediate', 'Advanced', 'Professional')),
  "contact_hours" NUMERIC,
  "default_capacity" INTEGER DEFAULT 20,
  "default_fee" NUMERIC,
  "status" TEXT NOT NULL DEFAULT 'Active' CHECK ("status" IS NULL OR "status" IN ('Draft', 'Active', 'Inactive', 'Retired')),
  "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
  "updated_at" TEXT NOT NULL DEFAULT (datetime('now'))
);

-- An application. Applicant details are held inline because no student row exists until the application is accepted; `student` is back-filled then.
CREATE TABLE "admissions" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT NOT NULL
  -- name: Zoho stock display field -- always text, so it cannot BE the auto-number. Workflow-composed from application_no.
,  "application_no" TEXT UNIQUE,
  "applicant_first_name" TEXT NOT NULL,
  "applicant_last_name" TEXT NOT NULL,
  "applicant_date_of_birth" TEXT,
  "applicant_gender" TEXT CHECK ("applicant_gender" IS NULL OR "applicant_gender" IN ('Male', 'Female', 'Other', 'Prefer Not To Say')),
  "guardian_name" TEXT,
  "guardian_phone" TEXT,
  "guardian_email" TEXT,
  "household_id" INTEGER REFERENCES "households" ("id") ON DELETE SET NULL
  -- household_id: Linked once an existing family is matched, or created on acceptance.
,  "student_id" INTEGER REFERENCES "students" ("id") ON DELETE SET NULL
  -- student_id: Back-filled when the application is accepted.
,  "term_id" INTEGER NOT NULL REFERENCES "terms" ("id") ON DELETE RESTRICT,
  "program_id" INTEGER REFERENCES "programs" ("id") ON DELETE SET NULL,
  "source" TEXT CHECK ("source" IS NULL OR "source" IN ('Walk In', 'Website', 'Referral', 'Social Media', 'Agent', 'Event', 'Other')),
  "stage" TEXT NOT NULL DEFAULT 'Enquiry' CHECK ("stage" IS NULL OR "stage" IN ('Enquiry', 'Application Submitted', 'Documents Pending', 'Interview', 'Offered', 'Accepted', 'Enrolled', 'Rejected', 'Withdrawn')),
  "applied_date" TEXT NOT NULL,
  "interview_date" TEXT,
  "decision_date" TEXT,
  "decision_by_id" TEXT,
  "rejection_reason" TEXT,
  "notes" TEXT
  -- notes: api_name is not 'Notes' -- Zoho reserves that keyword.
,  "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
  "updated_at" TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A section/batch: course x term x weekly timetable. NOT a dated lesson -- that is `class_sessions`. Attendance never attaches here.
CREATE TABLE "classes" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT NOT NULL
  -- name: e.g. 'MATH101 - 2026T1 - A'
,  "class_code" TEXT NOT NULL UNIQUE,
  "course_id" INTEGER NOT NULL REFERENCES "courses" ("id") ON DELETE RESTRICT,
  "term_id" INTEGER NOT NULL REFERENCES "terms" ("id") ON DELETE RESTRICT,
  "section_label" TEXT
  -- section_label: e.g. 'A', 'B', 'Evening'
,  "primary_teacher_id" INTEGER REFERENCES "teachers" ("id") ON DELETE SET NULL,
  "room" TEXT,
  "capacity" INTEGER NOT NULL DEFAULT 20,
  "meeting_days" TEXT CHECK ("meeting_days" IS NULL OR json_valid("meeting_days"))
  -- meeting_days: The weekly pattern that class_sessions rows are generated from.
,  "start_time" TEXT,
  "end_time" TEXT,
  "start_date" TEXT NOT NULL,
  "end_date" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Draft' CHECK ("status" IS NULL OR "status" IN ('Draft', 'Scheduled', 'Running', 'Completed', 'Cancelled')),
  "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
  "updated_at" TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT "class_dates_ordered" CHECK (end_date >= start_date),
  CONSTRAINT "class_capacity_positive" CHECK (capacity > 0)
);

-- A single dated meeting of a class, generated from the weekly pattern on `classes`. teacher_taken records who actually ran it, which may differ from the class primary_teacher (substitutions).
CREATE TABLE "class_sessions" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT NOT NULL
  -- name: Auto-composed: '<class_code> - <session_date>'
,  "class_id" INTEGER NOT NULL REFERENCES "classes" ("id") ON DELETE CASCADE,
  "session_date" TEXT NOT NULL,
  "start_time" TEXT,
  "end_time" TEXT,
  "sequence_no" INTEGER
  -- sequence_no: 1-based ordinal within the class.
,  "teacher_taken_id" INTEGER REFERENCES "teachers" ("id") ON DELETE SET NULL,
  "status" TEXT NOT NULL DEFAULT 'Scheduled' CHECK ("status" IS NULL OR "status" IN ('Scheduled', 'Held', 'Cancelled', 'Rescheduled', 'Makeup')),
  "topic" TEXT,
  "notes" TEXT
  -- notes: api_name is not 'Notes' -- Zoho reserves that keyword.
,  "attendance_taken" INTEGER DEFAULT 0,
  "attendance_taken_at" TEXT,
  "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
  "updated_at" TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT "uq_session_per_class_date" UNIQUE ("class_id", "session_date", "start_time")
);

-- Joins a student to a class. `course` and `term` are intentionally denormalized: Zoho COQL cannot join two hops, so "all enrollments in Term 1" is only answerable if the term sits on this record. Both are derived from `class` and kept in step by workflow (Zoho) / trigger (SQL).
CREATE TABLE "enrollments" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT NOT NULL
  -- name: Zoho stock display field -- always text, so it cannot BE the auto-number. Workflow-composed from enrollment_no.
,  "enrollment_no" TEXT UNIQUE,
  "student_id" INTEGER NOT NULL REFERENCES "students" ("id") ON DELETE CASCADE,
  "class_id" INTEGER NOT NULL REFERENCES "classes" ("id") ON DELETE CASCADE,
  "course_id" INTEGER REFERENCES "courses" ("id") ON DELETE SET NULL,
  "term_id" INTEGER REFERENCES "terms" ("id") ON DELETE SET NULL,
  "status" TEXT NOT NULL DEFAULT 'Pending' CHECK ("status" IS NULL OR "status" IN ('Pending', 'Active', 'Completed', 'Dropped', 'Transferred')),
  "enrolled_on" TEXT NOT NULL,
  "dropped_on" TEXT,
  "drop_reason" TEXT,
  "fee_amount" NUMERIC,
  "discount" NUMERIC DEFAULT 0,
  "payment_status" TEXT DEFAULT 'Unpaid' CHECK ("payment_status" IS NULL OR "payment_status" IN ('Unpaid', 'Partially Paid', 'Paid', 'Waived', 'Refunded')),
  "final_grade" TEXT,
  "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
  "updated_at" TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT "uq_enrollment_student_class" UNIQUE ("student_id", "class_id")
);

-- Teacher assigned to a class. class_session is NULL for a whole-term allocation and set only for a one-off substitution on that date.
CREATE TABLE "allocations" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT NOT NULL
  -- name: Zoho stock display field -- always text, so it cannot BE the auto-number. Workflow-composed from allocation_no.
,  "allocation_no" TEXT UNIQUE,
  "teacher_id" INTEGER NOT NULL REFERENCES "teachers" ("id") ON DELETE RESTRICT,
  "class_id" INTEGER NOT NULL REFERENCES "classes" ("id") ON DELETE CASCADE,
  "class_session_id" INTEGER REFERENCES "class_sessions" ("id") ON DELETE CASCADE
  -- class_session_id: NULL = allocation covers the whole class. Set = single-session substitution.
,  "role" TEXT NOT NULL DEFAULT 'Lead Teacher' CHECK ("role" IS NULL OR "role" IN ('Lead Teacher', 'Assistant', 'Substitute', 'Observer')),
  "effective_from" TEXT,
  "effective_to" TEXT,
  "status" TEXT NOT NULL DEFAULT 'Planned' CHECK ("status" IS NULL OR "status" IN ('Planned', 'Active', 'Ended', 'Cancelled')),
  "notes" TEXT
  -- notes: api_name is not 'Notes' -- Zoho reserves that keyword.
,  "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
  "updated_at" TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT "allocation_dates_ordered" CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);

-- One mark per enrolled student per session. `student` and `class` are denormalized off the enrollment for the same COQL reason as enrollments. Highest-volume table: students x classes-each x sessions-per-term.
CREATE TABLE "attendance" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT NOT NULL
  -- name: Zoho stock display field -- always text, so it cannot BE the auto-number. Workflow-composed from attendance_no.
,  "attendance_no" TEXT UNIQUE,
  "class_session_id" INTEGER NOT NULL REFERENCES "class_sessions" ("id") ON DELETE CASCADE,
  "enrollment_id" INTEGER NOT NULL REFERENCES "enrollments" ("id") ON DELETE CASCADE,
  "student_id" INTEGER NOT NULL REFERENCES "students" ("id") ON DELETE CASCADE,
  "class_id" INTEGER NOT NULL REFERENCES "classes" ("id") ON DELETE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'Present' CHECK ("status" IS NULL OR "status" IN ('Present', 'Absent', 'Late', 'Excused', 'Left Early')),
  "minutes_late" INTEGER DEFAULT 0,
  "marked_by_id" INTEGER REFERENCES "teachers" ("id") ON DELETE SET NULL
  -- marked_by_id: The teacher who took the class and recorded the mark.
,  "marked_at" TEXT,
  "remarks" TEXT,
  "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
  "updated_at" TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT "uq_attendance_enrollment_session" UNIQUE ("enrollment_id", "class_session_id"),
  CONSTRAINT "attendance_minutes_late_nonneg" CHECK (minutes_late >= 0)
);

-- ---------------------------------------------------------------------------
-- Auto-number triggers: bump the counter, then format the value
-- ---------------------------------------------------------------------------

CREATE TRIGGER "trg_households_household_code" AFTER INSERT ON "households"
FOR EACH ROW WHEN NEW."household_code" IS NULL
BEGIN
  UPDATE "_counters" SET "value" = "value" + 1 WHERE "name" = 'households_household_code';
  UPDATE "households" SET "household_code" =
    'HH-' || substr('00000' || (SELECT "value" FROM "_counters" WHERE "name" = 'households_household_code'), -5)
  WHERE "id" = NEW."id";
END;

CREATE TRIGGER "trg_students_student_code" AFTER INSERT ON "students"
FOR EACH ROW WHEN NEW."student_code" IS NULL
BEGIN
  UPDATE "_counters" SET "value" = "value" + 1 WHERE "name" = 'students_student_code';
  UPDATE "students" SET "student_code" =
    'STU-' || substr('00000' || (SELECT "value" FROM "_counters" WHERE "name" = 'students_student_code'), -5)
  WHERE "id" = NEW."id";
END;

CREATE TRIGGER "trg_teachers_staff_code" AFTER INSERT ON "teachers"
FOR EACH ROW WHEN NEW."staff_code" IS NULL
BEGIN
  UPDATE "_counters" SET "value" = "value" + 1 WHERE "name" = 'teachers_staff_code';
  UPDATE "teachers" SET "staff_code" =
    'TCH-' || substr('0000' || (SELECT "value" FROM "_counters" WHERE "name" = 'teachers_staff_code'), -4)
  WHERE "id" = NEW."id";
END;

CREATE TRIGGER "trg_admissions_application_no" AFTER INSERT ON "admissions"
FOR EACH ROW WHEN NEW."application_no" IS NULL
BEGIN
  UPDATE "_counters" SET "value" = "value" + 1 WHERE "name" = 'admissions_application_no';
  UPDATE "admissions" SET "application_no" =
    'APP-' || substr('00000' || (SELECT "value" FROM "_counters" WHERE "name" = 'admissions_application_no'), -5)
  WHERE "id" = NEW."id";
END;

CREATE TRIGGER "trg_enrollments_enrollment_no" AFTER INSERT ON "enrollments"
FOR EACH ROW WHEN NEW."enrollment_no" IS NULL
BEGIN
  UPDATE "_counters" SET "value" = "value" + 1 WHERE "name" = 'enrollments_enrollment_no';
  UPDATE "enrollments" SET "enrollment_no" =
    'ENR-' || substr('000000' || (SELECT "value" FROM "_counters" WHERE "name" = 'enrollments_enrollment_no'), -6)
  WHERE "id" = NEW."id";
END;

CREATE TRIGGER "trg_allocations_allocation_no" AFTER INSERT ON "allocations"
FOR EACH ROW WHEN NEW."allocation_no" IS NULL
BEGIN
  UPDATE "_counters" SET "value" = "value" + 1 WHERE "name" = 'allocations_allocation_no';
  UPDATE "allocations" SET "allocation_no" =
    'ALC-' || substr('00000' || (SELECT "value" FROM "_counters" WHERE "name" = 'allocations_allocation_no'), -5)
  WHERE "id" = NEW."id";
END;

CREATE TRIGGER "trg_attendance_attendance_no" AFTER INSERT ON "attendance"
FOR EACH ROW WHEN NEW."attendance_no" IS NULL
BEGIN
  UPDATE "_counters" SET "value" = "value" + 1 WHERE "name" = 'attendance_attendance_no';
  UPDATE "attendance" SET "attendance_no" =
    'ATT-' || substr('0000000' || (SELECT "value" FROM "_counters" WHERE "name" = 'attendance_attendance_no'), -7)
  WHERE "id" = NEW."id";
END;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

CREATE TRIGGER "trg_households_updated_at" AFTER UPDATE ON "households"
FOR EACH ROW WHEN NEW."updated_at" = OLD."updated_at"
BEGIN
  UPDATE "households" SET "updated_at" = datetime('now') WHERE "id" = NEW."id";
END;

CREATE TRIGGER "trg_students_updated_at" AFTER UPDATE ON "students"
FOR EACH ROW WHEN NEW."updated_at" = OLD."updated_at"
BEGIN
  UPDATE "students" SET "updated_at" = datetime('now') WHERE "id" = NEW."id";
END;

CREATE TRIGGER "trg_teachers_updated_at" AFTER UPDATE ON "teachers"
FOR EACH ROW WHEN NEW."updated_at" = OLD."updated_at"
BEGIN
  UPDATE "teachers" SET "updated_at" = datetime('now') WHERE "id" = NEW."id";
END;

CREATE TRIGGER "trg_terms_updated_at" AFTER UPDATE ON "terms"
FOR EACH ROW WHEN NEW."updated_at" = OLD."updated_at"
BEGIN
  UPDATE "terms" SET "updated_at" = datetime('now') WHERE "id" = NEW."id";
END;

CREATE TRIGGER "trg_programs_updated_at" AFTER UPDATE ON "programs"
FOR EACH ROW WHEN NEW."updated_at" = OLD."updated_at"
BEGIN
  UPDATE "programs" SET "updated_at" = datetime('now') WHERE "id" = NEW."id";
END;

CREATE TRIGGER "trg_courses_updated_at" AFTER UPDATE ON "courses"
FOR EACH ROW WHEN NEW."updated_at" = OLD."updated_at"
BEGIN
  UPDATE "courses" SET "updated_at" = datetime('now') WHERE "id" = NEW."id";
END;

CREATE TRIGGER "trg_admissions_updated_at" AFTER UPDATE ON "admissions"
FOR EACH ROW WHEN NEW."updated_at" = OLD."updated_at"
BEGIN
  UPDATE "admissions" SET "updated_at" = datetime('now') WHERE "id" = NEW."id";
END;

CREATE TRIGGER "trg_classes_updated_at" AFTER UPDATE ON "classes"
FOR EACH ROW WHEN NEW."updated_at" = OLD."updated_at"
BEGIN
  UPDATE "classes" SET "updated_at" = datetime('now') WHERE "id" = NEW."id";
END;

CREATE TRIGGER "trg_class_sessions_updated_at" AFTER UPDATE ON "class_sessions"
FOR EACH ROW WHEN NEW."updated_at" = OLD."updated_at"
BEGIN
  UPDATE "class_sessions" SET "updated_at" = datetime('now') WHERE "id" = NEW."id";
END;

CREATE TRIGGER "trg_enrollments_updated_at" AFTER UPDATE ON "enrollments"
FOR EACH ROW WHEN NEW."updated_at" = OLD."updated_at"
BEGIN
  UPDATE "enrollments" SET "updated_at" = datetime('now') WHERE "id" = NEW."id";
END;

CREATE TRIGGER "trg_allocations_updated_at" AFTER UPDATE ON "allocations"
FOR EACH ROW WHEN NEW."updated_at" = OLD."updated_at"
BEGIN
  UPDATE "allocations" SET "updated_at" = datetime('now') WHERE "id" = NEW."id";
END;

CREATE TRIGGER "trg_attendance_updated_at" AFTER UPDATE ON "attendance"
FOR EACH ROW WHEN NEW."updated_at" = OLD."updated_at"
BEGIN
  UPDATE "attendance" SET "updated_at" = datetime('now') WHERE "id" = NEW."id";
END;

-- ---------------------------------------------------------------------------
-- Derived columns, kept in step with their source row
-- ---------------------------------------------------------------------------

CREATE TRIGGER "trg_enrollments_derived_insert" AFTER INSERT ON "enrollments"
FOR EACH ROW
BEGIN
  UPDATE "enrollments" SET
    "course_id" = (SELECT "course_id" FROM "classes" WHERE "id" = NEW."class_id"),
    "term_id" = (SELECT "term_id" FROM "classes" WHERE "id" = NEW."class_id")
  WHERE "id" = NEW."id";
END;

CREATE TRIGGER "trg_enrollments_derived_update" AFTER UPDATE ON "enrollments"
FOR EACH ROW
BEGIN
  UPDATE "enrollments" SET
    "course_id" = (SELECT "course_id" FROM "classes" WHERE "id" = NEW."class_id"),
    "term_id" = (SELECT "term_id" FROM "classes" WHERE "id" = NEW."class_id")
  WHERE "id" = NEW."id";
END;

CREATE TRIGGER "trg_attendance_derived_insert" AFTER INSERT ON "attendance"
FOR EACH ROW
BEGIN
  UPDATE "attendance" SET
    "student_id" = (SELECT "student_id" FROM "enrollments" WHERE "id" = NEW."enrollment_id"),
    "class_id" = (SELECT "class_id" FROM "enrollments" WHERE "id" = NEW."enrollment_id")
  WHERE "id" = NEW."id";
END;

CREATE TRIGGER "trg_attendance_derived_update" AFTER UPDATE ON "attendance"
FOR EACH ROW
BEGIN
  UPDATE "attendance" SET
    "student_id" = (SELECT "student_id" FROM "enrollments" WHERE "id" = NEW."enrollment_id"),
    "class_id" = (SELECT "class_id" FROM "enrollments" WHERE "id" = NEW."enrollment_id")
  WHERE "id" = NEW."id";
END;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX "idx_students_household_id" ON "students" ("household_id");
CREATE INDEX "idx_courses_program_id" ON "courses" ("program_id");
CREATE INDEX "idx_admissions_household_id" ON "admissions" ("household_id");
CREATE INDEX "idx_admissions_student_id" ON "admissions" ("student_id");
CREATE INDEX "idx_admissions_term_id" ON "admissions" ("term_id");
CREATE INDEX "idx_admissions_program_id" ON "admissions" ("program_id");
CREATE INDEX "idx_classes_course_id" ON "classes" ("course_id");
CREATE INDEX "idx_classes_term_id" ON "classes" ("term_id");
CREATE INDEX "idx_classes_primary_teacher_id" ON "classes" ("primary_teacher_id");
CREATE INDEX "idx_class_sessions_class_id" ON "class_sessions" ("class_id");
CREATE INDEX "idx_class_sessions_teacher_taken_id" ON "class_sessions" ("teacher_taken_id");
CREATE INDEX "idx_enrollments_student_id" ON "enrollments" ("student_id");
CREATE INDEX "idx_enrollments_class_id" ON "enrollments" ("class_id");
CREATE INDEX "idx_enrollments_course_id" ON "enrollments" ("course_id");
CREATE INDEX "idx_enrollments_term_id" ON "enrollments" ("term_id");
CREATE INDEX "idx_allocations_teacher_id" ON "allocations" ("teacher_id");
CREATE INDEX "idx_allocations_class_id" ON "allocations" ("class_id");
CREATE INDEX "idx_allocations_class_session_id" ON "allocations" ("class_session_id");
CREATE INDEX "idx_attendance_class_session_id" ON "attendance" ("class_session_id");
CREATE INDEX "idx_attendance_enrollment_id" ON "attendance" ("enrollment_id");
CREATE INDEX "idx_attendance_student_id" ON "attendance" ("student_id");
CREATE INDEX "idx_attendance_class_id" ON "attendance" ("class_id");
CREATE INDEX "idx_attendance_marked_by_id" ON "attendance" ("marked_by_id");
CREATE INDEX "idx_session_class_date" ON "class_sessions" ("class_id", "session_date");
CREATE INDEX "idx_session_date" ON "class_sessions" ("session_date");
CREATE INDEX "idx_student_status" ON "students" ("status");
CREATE INDEX "idx_enrollment_term_status" ON "enrollments" ("term_id", "status");
CREATE INDEX "idx_attendance_student_status" ON "attendance" ("student_id", "status");
CREATE INDEX "idx_attendance_session_status" ON "attendance" ("class_session_id", "status");
CREATE INDEX "idx_admission_term_stage" ON "admissions" ("term_id", "stage");

-- ---------------------------------------------------------------------------
-- Rollup views. `v_<table>` = the base table plus its derived counters.
-- ---------------------------------------------------------------------------

CREATE VIEW "v_households" AS
SELECT "households".*,
  (SELECT count(*) FROM "students" WHERE "students"."household_id" = "households"."id" AND (status = 'Active')) AS "active_students_count"
FROM "households";

CREATE VIEW "v_students" AS
SELECT "students".*,
  (SELECT count(*) FROM "enrollments" WHERE "enrollments"."student_id" = "students"."id" AND (status = 'Active')) AS "active_enrollments_count"
FROM "students";

CREATE VIEW "v_programs" AS
SELECT "programs".*,
  (SELECT count(*) FROM "courses" WHERE "courses"."program_id" = "programs"."id") AS "courses_count"
FROM "programs";

CREATE VIEW "v_classes" AS
SELECT "classes".*,
  (SELECT count(*) FROM "enrollments" WHERE "enrollments"."class_id" = "classes"."id" AND (status = 'Active')) AS "enrolled_count",
  (SELECT count(*) FROM "class_sessions" WHERE "class_sessions"."class_id" = "classes"."id") AS "sessions_count"
FROM "classes";

CREATE VIEW "v_class_sessions" AS
SELECT "class_sessions".*,
  (SELECT count(*) FROM "attendance" WHERE "attendance"."class_session_id" = "class_sessions"."id" AND (status IN ('Present','Late'))) AS "present_count",
  (SELECT count(*) FROM "attendance" WHERE "attendance"."class_session_id" = "class_sessions"."id" AND (status = 'Absent')) AS "absent_count"
FROM "class_sessions";

CREATE VIEW "v_enrollments" AS
SELECT "enrollments".*,
  (SELECT round(100.0 * sum(CASE WHEN status IN ('Present','Late') THEN 1 ELSE 0 END)
                / NULLIF(sum(CASE WHEN status <> 'Excused' THEN 1 ELSE 0 END), 0), 2)
     FROM "attendance" WHERE "attendance"."enrollment_id" = "enrollments"."id") AS "attendance_rate"
FROM "enrollments";

COMMIT;
