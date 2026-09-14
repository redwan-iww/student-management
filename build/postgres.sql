-- GENERATED FILE -- do not edit.
-- Source: schema/model.yaml + schema/enums.yaml   (npm run gen:sql)

BEGIN;

-- ---------------------------------------------------------------------------
-- Enum types
-- ---------------------------------------------------------------------------

CREATE TYPE "academic_level" AS ENUM (
  'Foundation',
  'Beginner',
  'Intermediate',
  'Advanced',
  'Professional'
);

CREATE TYPE "admission_source" AS ENUM (
  'Walk In',
  'Website',
  'Referral',
  'Social Media',
  'Agent',
  'Event',
  'Other'
);

CREATE TYPE "admission_stage" AS ENUM (
  'Enquiry',
  'Application Submitted',
  'Documents Pending',
  'Interview',
  'Offered',
  'Accepted',
  'Enrolled',
  'Rejected',
  'Withdrawn'
);

CREATE TYPE "allocation_role" AS ENUM (
  'Lead Teacher',
  'Assistant',
  'Substitute',
  'Observer'
);

CREATE TYPE "allocation_status" AS ENUM (
  'Planned',
  'Active',
  'Ended',
  'Cancelled'
);

CREATE TYPE "attendance_status" AS ENUM (
  'Present',
  'Absent',
  'Late',
  'Excused',
  'Left Early'
);

CREATE TYPE "billing_status" AS ENUM (
  'Current',
  'Overdue',
  'On Hold',
  'Closed'
);

CREATE TYPE "catalog_status" AS ENUM (
  'Draft',
  'Active',
  'Inactive',
  'Retired'
);

CREATE TYPE "class_status" AS ENUM (
  'Draft',
  'Scheduled',
  'Running',
  'Completed',
  'Cancelled'
);

CREATE TYPE "contact_method" AS ENUM (
  'Email',
  'Phone',
  'SMS',
  'WhatsApp'
);

CREATE TYPE "enrollment_status" AS ENUM (
  'Pending',
  'Active',
  'Completed',
  'Dropped',
  'Transferred'
);

CREATE TYPE "gender" AS ENUM (
  'Male',
  'Female',
  'Other',
  'Prefer Not To Say'
);

CREATE TYPE "guardian_relationship" AS ENUM (
  'Mother',
  'Father',
  'Grandparent',
  'Legal Guardian',
  'Sibling',
  'Other'
);

CREATE TYPE "payment_status" AS ENUM (
  'Unpaid',
  'Partially Paid',
  'Paid',
  'Waived',
  'Refunded'
);

CREATE TYPE "session_status" AS ENUM (
  'Scheduled',
  'Held',
  'Cancelled',
  'Rescheduled',
  'Makeup'
);

CREATE TYPE "student_status" AS ENUM (
  'Prospective',
  'Active',
  'On Hold',
  'Withdrawn',
  'Graduated',
  'Alumni'
);

CREATE TYPE "teacher_employment_type" AS ENUM (
  'Full Time',
  'Part Time',
  'Contract',
  'Visiting'
);

CREATE TYPE "teacher_status" AS ENUM (
  'Active',
  'On Leave',
  'Inactive'
);

CREATE TYPE "term_status" AS ENUM (
  'Planned',
  'Open',
  'In Progress',
  'Closed',
  'Archived'
);

CREATE TYPE "weekday" AS ENUM (
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday'
);

-- Auto-number sequences
CREATE SEQUENCE "households_household_code_seq";
CREATE SEQUENCE "students_student_code_seq";
CREATE SEQUENCE "teachers_staff_code_seq";
CREATE SEQUENCE "admissions_application_no_seq";
CREATE SEQUENCE "enrollments_enrollment_no_seq";
CREATE SEQUENCE "allocations_allocation_no_seq";
CREATE SEQUENCE "attendance_attendance_no_seq";

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE "households" (
  "id" bigserial PRIMARY KEY,
  "household_name" varchar(120) NOT NULL,
  "household_code" varchar(40) NOT NULL DEFAULT ('HH-' || lpad(nextval('households_household_code_seq')::text, 5, '0')) UNIQUE,
  "primary_guardian_name" varchar(120) NOT NULL,
  "primary_guardian_relationship" "guardian_relationship",
  "email" varchar(160),
  "phone" varchar(40),
  "mobile" varchar(40),
  "secondary_guardian_name" varchar(120),
  "secondary_guardian_relationship" "guardian_relationship",
  "secondary_guardian_phone" varchar(40),
  "secondary_guardian_email" varchar(160),
  "preferred_contact_method" "contact_method" DEFAULT 'Email'::"contact_method",
  "address_line" varchar(250),
  "city" varchar(80),
  "postcode" varchar(20),
  "country" varchar(80),
  "billing_status" "billing_status" DEFAULT 'Current'::"billing_status",
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "students" (
  "id" bigserial PRIMARY KEY,
  "full_name" varchar(120) NOT NULL,
  "student_code" varchar(40) NOT NULL DEFAULT ('STU-' || lpad(nextval('students_student_code_seq')::text, 5, '0')) UNIQUE,
  "household_id" bigint NOT NULL,
  "first_name" varchar(60) NOT NULL,
  "last_name" varchar(60) NOT NULL,
  "date_of_birth" date,
  "gender" "gender",
  "status" "student_status" NOT NULL DEFAULT 'Prospective'::"student_status",
  "email" varchar(160),
  "phone" varchar(40),
  "enrollment_date" date,
  "exit_date" date,
  "emergency_contact_name" varchar(120),
  "emergency_contact_phone" varchar(40),
  "medical_notes" text,
  "photo" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "teachers" (
  "id" bigserial PRIMARY KEY,
  "full_name" varchar(120) NOT NULL,
  "staff_code" varchar(40) NOT NULL DEFAULT ('TCH-' || lpad(nextval('teachers_staff_code_seq')::text, 4, '0')) UNIQUE,
  "email" varchar(160) UNIQUE,
  "phone" varchar(40),
  "crm_user_id" varchar(64),
  "employment_type" "teacher_employment_type",
  "specialisms" "academic_level"[],
  "status" "teacher_status" NOT NULL DEFAULT 'Active'::"teacher_status",
  "joined_on" date,
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "terms" (
  "id" bigserial PRIMARY KEY,
  "name" varchar(120) NOT NULL,
  "term_code" varchar(30) NOT NULL UNIQUE,
  "academic_year" integer NOT NULL,
  "sequence_no" integer,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "enrollment_opens" date,
  "enrollment_closes" date,
  "status" "term_status" NOT NULL DEFAULT 'Planned'::"term_status",
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "term_dates_ordered" CHECK (end_date >= start_date)
);

CREATE TABLE "programs" (
  "id" bigserial PRIMARY KEY,
  "name" varchar(120) NOT NULL,
  "program_code" varchar(30) NOT NULL UNIQUE,
  "description" text,
  "level" "academic_level",
  "duration_terms" integer,
  "status" "catalog_status" NOT NULL DEFAULT 'Active'::"catalog_status",
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "courses" (
  "id" bigserial PRIMARY KEY,
  "name" varchar(120) NOT NULL,
  "course_code" varchar(30) NOT NULL UNIQUE,
  "program_id" bigint,
  "description" text,
  "level" "academic_level",
  "contact_hours" numeric(6,2),
  "default_capacity" integer DEFAULT 20,
  "default_fee" numeric(14,2),
  "status" "catalog_status" NOT NULL DEFAULT 'Active'::"catalog_status",
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "admissions" (
  "id" bigserial PRIMARY KEY,
  "name" varchar(120) NOT NULL,
  "application_no" varchar(40) NOT NULL DEFAULT ('APP-' || lpad(nextval('admissions_application_no_seq')::text, 5, '0')) UNIQUE,
  "applicant_first_name" varchar(60) NOT NULL,
  "applicant_last_name" varchar(60) NOT NULL,
  "applicant_date_of_birth" date,
  "applicant_gender" "gender",
  "guardian_name" varchar(120),
  "guardian_phone" varchar(40),
  "guardian_email" varchar(160),
  "household_id" bigint,
  "student_id" bigint,
  "term_id" bigint NOT NULL,
  "program_id" bigint,
  "source" "admission_source",
  "stage" "admission_stage" NOT NULL DEFAULT 'Enquiry'::"admission_stage",
  "applied_date" date NOT NULL,
  "interview_date" timestamptz,
  "decision_date" date,
  "decision_by_id" varchar(64),
  "rejection_reason" text,
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "classes" (
  "id" bigserial PRIMARY KEY,
  "name" varchar(120) NOT NULL,
  "class_code" varchar(40) NOT NULL UNIQUE,
  "course_id" bigint NOT NULL,
  "term_id" bigint NOT NULL,
  "section_label" varchar(10),
  "primary_teacher_id" bigint,
  "room" varchar(60),
  "capacity" integer NOT NULL DEFAULT 20,
  "meeting_days" "weekday"[],
  "start_time" time,
  "end_time" time,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "status" "class_status" NOT NULL DEFAULT 'Draft'::"class_status",
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "class_dates_ordered" CHECK (end_date >= start_date),
  CONSTRAINT "class_capacity_positive" CHECK (capacity > 0)
);

CREATE TABLE "class_sessions" (
  "id" bigserial PRIMARY KEY,
  "name" varchar(160) NOT NULL,
  "class_id" bigint NOT NULL,
  "session_date" date NOT NULL,
  "start_time" time,
  "end_time" time,
  "sequence_no" integer,
  "teacher_taken_id" bigint,
  "status" "session_status" NOT NULL DEFAULT 'Scheduled'::"session_status",
  "topic" varchar(200),
  "notes" text,
  "attendance_taken" boolean DEFAULT false,
  "attendance_taken_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "uq_session_per_class_date" UNIQUE ("class_id", "session_date", "start_time")
);

CREATE TABLE "enrollments" (
  "id" bigserial PRIMARY KEY,
  "name" varchar(120) NOT NULL,
  "enrollment_no" varchar(40) NOT NULL DEFAULT ('ENR-' || lpad(nextval('enrollments_enrollment_no_seq')::text, 6, '0')) UNIQUE,
  "student_id" bigint NOT NULL,
  "class_id" bigint NOT NULL,
  "course_id" bigint,
  "term_id" bigint,
  "status" "enrollment_status" NOT NULL DEFAULT 'Pending'::"enrollment_status",
  "enrolled_on" date NOT NULL,
  "dropped_on" date,
  "drop_reason" text,
  "fee_amount" numeric(14,2),
  "discount" numeric(14,2) DEFAULT 0,
  "payment_status" "payment_status" DEFAULT 'Unpaid'::"payment_status",
  "final_grade" varchar(10),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "uq_enrollment_student_class" UNIQUE ("student_id", "class_id")
);

CREATE TABLE "allocations" (
  "id" bigserial PRIMARY KEY,
  "name" varchar(120) NOT NULL,
  "allocation_no" varchar(40) NOT NULL DEFAULT ('ALC-' || lpad(nextval('allocations_allocation_no_seq')::text, 5, '0')) UNIQUE,
  "teacher_id" bigint NOT NULL,
  "class_id" bigint NOT NULL,
  "class_session_id" bigint,
  "role" "allocation_role" NOT NULL DEFAULT 'Lead Teacher'::"allocation_role",
  "effective_from" date,
  "effective_to" date,
  "status" "allocation_status" NOT NULL DEFAULT 'Planned'::"allocation_status",
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "allocation_dates_ordered" CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);

CREATE TABLE "attendance" (
  "id" bigserial PRIMARY KEY,
  "name" varchar(120) NOT NULL,
  "attendance_no" varchar(40) NOT NULL DEFAULT ('ATT-' || lpad(nextval('attendance_attendance_no_seq')::text, 7, '0')) UNIQUE,
  "class_session_id" bigint NOT NULL,
  "enrollment_id" bigint NOT NULL,
  "student_id" bigint NOT NULL,
  "class_id" bigint NOT NULL,
  "status" "attendance_status" NOT NULL DEFAULT 'Present'::"attendance_status",
  "minutes_late" integer DEFAULT 0,
  "marked_by_id" bigint,
  "marked_at" timestamptz,
  "remarks" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "uq_attendance_enrollment_session" UNIQUE ("enrollment_id", "class_session_id"),
  CONSTRAINT "attendance_minutes_late_nonneg" CHECK (minutes_late >= 0)
);

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------

ALTER TABLE "students" ADD CONSTRAINT "fk_students_household_id" FOREIGN KEY ("household_id") REFERENCES "households" ("id") ON DELETE RESTRICT;
ALTER TABLE "courses" ADD CONSTRAINT "fk_courses_program_id" FOREIGN KEY ("program_id") REFERENCES "programs" ("id") ON DELETE SET NULL;
ALTER TABLE "admissions" ADD CONSTRAINT "fk_admissions_household_id" FOREIGN KEY ("household_id") REFERENCES "households" ("id") ON DELETE SET NULL;
ALTER TABLE "admissions" ADD CONSTRAINT "fk_admissions_student_id" FOREIGN KEY ("student_id") REFERENCES "students" ("id") ON DELETE SET NULL;
ALTER TABLE "admissions" ADD CONSTRAINT "fk_admissions_term_id" FOREIGN KEY ("term_id") REFERENCES "terms" ("id") ON DELETE RESTRICT;
ALTER TABLE "admissions" ADD CONSTRAINT "fk_admissions_program_id" FOREIGN KEY ("program_id") REFERENCES "programs" ("id") ON DELETE SET NULL;
ALTER TABLE "classes" ADD CONSTRAINT "fk_classes_course_id" FOREIGN KEY ("course_id") REFERENCES "courses" ("id") ON DELETE RESTRICT;
ALTER TABLE "classes" ADD CONSTRAINT "fk_classes_term_id" FOREIGN KEY ("term_id") REFERENCES "terms" ("id") ON DELETE RESTRICT;
ALTER TABLE "classes" ADD CONSTRAINT "fk_classes_primary_teacher_id" FOREIGN KEY ("primary_teacher_id") REFERENCES "teachers" ("id") ON DELETE SET NULL;
ALTER TABLE "class_sessions" ADD CONSTRAINT "fk_class_sessions_class_id" FOREIGN KEY ("class_id") REFERENCES "classes" ("id") ON DELETE CASCADE;
ALTER TABLE "class_sessions" ADD CONSTRAINT "fk_class_sessions_teacher_taken_id" FOREIGN KEY ("teacher_taken_id") REFERENCES "teachers" ("id") ON DELETE SET NULL;
ALTER TABLE "enrollments" ADD CONSTRAINT "fk_enrollments_student_id" FOREIGN KEY ("student_id") REFERENCES "students" ("id") ON DELETE CASCADE;
ALTER TABLE "enrollments" ADD CONSTRAINT "fk_enrollments_class_id" FOREIGN KEY ("class_id") REFERENCES "classes" ("id") ON DELETE CASCADE;
ALTER TABLE "enrollments" ADD CONSTRAINT "fk_enrollments_course_id" FOREIGN KEY ("course_id") REFERENCES "courses" ("id") ON DELETE SET NULL;
ALTER TABLE "enrollments" ADD CONSTRAINT "fk_enrollments_term_id" FOREIGN KEY ("term_id") REFERENCES "terms" ("id") ON DELETE SET NULL;
ALTER TABLE "allocations" ADD CONSTRAINT "fk_allocations_teacher_id" FOREIGN KEY ("teacher_id") REFERENCES "teachers" ("id") ON DELETE RESTRICT;
ALTER TABLE "allocations" ADD CONSTRAINT "fk_allocations_class_id" FOREIGN KEY ("class_id") REFERENCES "classes" ("id") ON DELETE CASCADE;
ALTER TABLE "allocations" ADD CONSTRAINT "fk_allocations_class_session_id" FOREIGN KEY ("class_session_id") REFERENCES "class_sessions" ("id") ON DELETE CASCADE;
ALTER TABLE "attendance" ADD CONSTRAINT "fk_attendance_class_session_id" FOREIGN KEY ("class_session_id") REFERENCES "class_sessions" ("id") ON DELETE CASCADE;
ALTER TABLE "attendance" ADD CONSTRAINT "fk_attendance_enrollment_id" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments" ("id") ON DELETE CASCADE;
ALTER TABLE "attendance" ADD CONSTRAINT "fk_attendance_student_id" FOREIGN KEY ("student_id") REFERENCES "students" ("id") ON DELETE CASCADE;
ALTER TABLE "attendance" ADD CONSTRAINT "fk_attendance_class_id" FOREIGN KEY ("class_id") REFERENCES "classes" ("id") ON DELETE CASCADE;
ALTER TABLE "attendance" ADD CONSTRAINT "fk_attendance_marked_by_id" FOREIGN KEY ("marked_by_id") REFERENCES "teachers" ("id") ON DELETE SET NULL;

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
-- updated_at maintenance
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "set_updated_at"() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_households_updated_at" BEFORE UPDATE ON "households" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
CREATE TRIGGER "trg_students_updated_at" BEFORE UPDATE ON "students" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
CREATE TRIGGER "trg_teachers_updated_at" BEFORE UPDATE ON "teachers" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
CREATE TRIGGER "trg_terms_updated_at" BEFORE UPDATE ON "terms" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
CREATE TRIGGER "trg_programs_updated_at" BEFORE UPDATE ON "programs" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
CREATE TRIGGER "trg_courses_updated_at" BEFORE UPDATE ON "courses" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
CREATE TRIGGER "trg_admissions_updated_at" BEFORE UPDATE ON "admissions" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
CREATE TRIGGER "trg_classes_updated_at" BEFORE UPDATE ON "classes" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
CREATE TRIGGER "trg_class_sessions_updated_at" BEFORE UPDATE ON "class_sessions" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
CREATE TRIGGER "trg_enrollments_updated_at" BEFORE UPDATE ON "enrollments" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
CREATE TRIGGER "trg_allocations_updated_at" BEFORE UPDATE ON "allocations" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
CREATE TRIGGER "trg_attendance_updated_at" BEFORE UPDATE ON "attendance" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();

-- ---------------------------------------------------------------------------
-- Derived columns (denormalized for query parity with Zoho COQL)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "sync_enrollments_derived"() RETURNS trigger AS $$
BEGIN
  NEW."course_id" := (SELECT "course_id" FROM "classes" WHERE "id" = NEW."class_id");
  NEW."term_id" := (SELECT "term_id" FROM "classes" WHERE "id" = NEW."class_id");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_enrollments_derived" BEFORE INSERT OR UPDATE ON "enrollments" FOR EACH ROW EXECUTE FUNCTION "sync_enrollments_derived"();

CREATE OR REPLACE FUNCTION "sync_attendance_derived"() RETURNS trigger AS $$
BEGIN
  NEW."student_id" := (SELECT "student_id" FROM "enrollments" WHERE "id" = NEW."enrollment_id");
  NEW."class_id" := (SELECT "class_id" FROM "enrollments" WHERE "id" = NEW."enrollment_id");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_attendance_derived" BEFORE INSERT OR UPDATE ON "attendance" FOR EACH ROW EXECUTE FUNCTION "sync_attendance_derived"();

-- ---------------------------------------------------------------------------
-- Rollup views. `v_<table>` = the base table plus its derived counters.
-- ---------------------------------------------------------------------------

CREATE VIEW "v_households" AS
SELECT "households".*,
  (SELECT count(*) FROM "students" WHERE "students"."household_id" = "households"."id" AND (status = 'Active'))::integer AS "active_students_count"
FROM "households";

CREATE VIEW "v_students" AS
SELECT "students".*,
  (SELECT count(*) FROM "enrollments" WHERE "enrollments"."student_id" = "students"."id" AND (status = 'Active'))::integer AS "active_enrollments_count"
FROM "students";

CREATE VIEW "v_programs" AS
SELECT "programs".*,
  (SELECT count(*) FROM "courses" WHERE "courses"."program_id" = "programs"."id")::integer AS "courses_count"
FROM "programs";

CREATE VIEW "v_classes" AS
SELECT "classes".*,
  (SELECT count(*) FROM "enrollments" WHERE "enrollments"."class_id" = "classes"."id" AND (status = 'Active'))::integer AS "enrolled_count",
  (SELECT count(*) FROM "class_sessions" WHERE "class_sessions"."class_id" = "classes"."id")::integer AS "sessions_count"
FROM "classes";

CREATE VIEW "v_class_sessions" AS
SELECT "class_sessions".*,
  (SELECT count(*) FROM "attendance" WHERE "attendance"."class_session_id" = "class_sessions"."id" AND (status IN ('Present','Late')))::integer AS "present_count",
  (SELECT count(*) FROM "attendance" WHERE "attendance"."class_session_id" = "class_sessions"."id" AND (status = 'Absent'))::integer AS "absent_count"
FROM "class_sessions";

CREATE VIEW "v_enrollments" AS
SELECT "enrollments".*,
  (SELECT round(100.0 * count(*) FILTER (WHERE status IN ('Present','Late'))
                / NULLIF(count(*) FILTER (WHERE status <> 'Excused'), 0), 2)
     FROM "attendance" WHERE "attendance"."enrollment_id" = "enrollments"."id")::numeric(5,2) AS "attendance_rate"
FROM "enrollments";

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------

COMMENT ON COLUMN "households"."household_name" IS 'Stock Zoho display field. Holds e.g. ''Rahman Family''.';
COMMENT ON COLUMN "households"."address_line" IS 'Zoho stock Mailing_Street is text, not textarea.';
COMMENT ON COLUMN "households"."notes" IS 'api_name is not ''Notes'' -- Zoho reserves that keyword.';
COMMENT ON TABLE "households" IS 'Family or billing unit. In Zoho this rides on the stock Contacts module, so one record is "the household plus its primary guardian". The entity is kept distinct in this spec so a future move to Accounts-as-household is a mapping change, not a remodel.';
COMMENT ON COLUMN "students"."full_name" IS 'Stock display field. Keep in step with first_name + last_name.';
COMMENT ON TABLE "students" IS 'The learner. Always belongs to exactly one household.';
COMMENT ON COLUMN "teachers"."crm_user_id" IS 'Null for unlicensed staff. Set only when the teacher has a CRM seat.';
COMMENT ON COLUMN "teachers"."notes" IS 'api_name is not ''Notes'' -- Zoho reserves that keyword.';
COMMENT ON TABLE "teachers" IS 'Teaching staff. A separate module rather than CRM users because the org holds only 2 user licences; crm_user links the minority who do have one.';
COMMENT ON COLUMN "terms"."name" IS 'e.g. ''2026 Term 1''';
COMMENT ON COLUMN "terms"."term_code" IS 'e.g. ''2026T1''';
COMMENT ON COLUMN "terms"."sequence_no" IS 'Order within the academic year: 1, 2, 3...';
COMMENT ON TABLE "terms" IS 'An academic term/session. Classes and enrollments are scoped to one.';
COMMENT ON TABLE "courses" IS 'What is taught. A course has no date and no teacher -- that is a `classes` row. The Zoho module name is resolved by the phase-3 audit: the org already holds an unrelated `Courses` (CustomModule2).';
COMMENT ON COLUMN "admissions"."name" IS 'Zoho stock display field -- always text, so it cannot BE the auto-number. Workflow-composed from application_no.';
COMMENT ON COLUMN "admissions"."household_id" IS 'Linked once an existing family is matched, or created on acceptance.';
COMMENT ON COLUMN "admissions"."student_id" IS 'Back-filled when the application is accepted.';
COMMENT ON COLUMN "admissions"."notes" IS 'api_name is not ''Notes'' -- Zoho reserves that keyword.';
COMMENT ON TABLE "admissions" IS 'An application. Applicant details are held inline because no student row exists until the application is accepted; `student` is back-filled then.';
COMMENT ON COLUMN "classes"."name" IS 'e.g. ''MATH101 - 2026T1 - A''';
COMMENT ON COLUMN "classes"."section_label" IS 'e.g. ''A'', ''B'', ''Evening''';
COMMENT ON COLUMN "classes"."meeting_days" IS 'The weekly pattern that class_sessions rows are generated from.';
COMMENT ON TABLE "classes" IS 'A section/batch: course x term x weekly timetable. NOT a dated lesson -- that is `class_sessions`. Attendance never attaches here.';
COMMENT ON COLUMN "class_sessions"."name" IS 'Auto-composed: ''<class_code> - <session_date>''';
COMMENT ON COLUMN "class_sessions"."sequence_no" IS '1-based ordinal within the class.';
COMMENT ON COLUMN "class_sessions"."notes" IS 'api_name is not ''Notes'' -- Zoho reserves that keyword.';
COMMENT ON TABLE "class_sessions" IS 'A single dated meeting of a class, generated from the weekly pattern on `classes`. teacher_taken records who actually ran it, which may differ from the class primary_teacher (substitutions).';
COMMENT ON COLUMN "enrollments"."name" IS 'Zoho stock display field -- always text, so it cannot BE the auto-number. Workflow-composed from enrollment_no.';
COMMENT ON TABLE "enrollments" IS 'Joins a student to a class. `course` and `term` are intentionally denormalized: Zoho COQL cannot join two hops, so "all enrollments in Term 1" is only answerable if the term sits on this record. Both are derived from `class` and kept in step by workflow (Zoho) / trigger (SQL).';
COMMENT ON COLUMN "allocations"."name" IS 'Zoho stock display field -- always text, so it cannot BE the auto-number. Workflow-composed from allocation_no.';
COMMENT ON COLUMN "allocations"."class_session_id" IS 'NULL = allocation covers the whole class. Set = single-session substitution.';
COMMENT ON COLUMN "allocations"."notes" IS 'api_name is not ''Notes'' -- Zoho reserves that keyword.';
COMMENT ON TABLE "allocations" IS 'Teacher assigned to a class. class_session is NULL for a whole-term allocation and set only for a one-off substitution on that date.';
COMMENT ON COLUMN "attendance"."name" IS 'Zoho stock display field -- always text, so it cannot BE the auto-number. Workflow-composed from attendance_no.';
COMMENT ON COLUMN "attendance"."marked_by_id" IS 'The teacher who took the class and recorded the mark.';
COMMENT ON TABLE "attendance" IS 'One mark per enrolled student per session. `student` and `class` are denormalized off the enrollment for the same COQL reason as enrollments. Highest-volume table: students x classes-each x sessions-per-term.';

COMMIT;
