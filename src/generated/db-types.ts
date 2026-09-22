// GENERATED FILE -- do not edit.
// Source: schema/model.yaml + schema/enums.yaml   (npm run gen:db-types)
//
// Rows are flat and snake_case, matching the SQL columns. A reference is the
// integer id of the target row.

// ---------------------------------------------------------------------------
// Picklists
// ---------------------------------------------------------------------------

export type BillingStatus =
  | 'Current'
  | 'Overdue'
  | 'On Hold'
  | 'Closed';

export const BILLING_STATUS_VALUES: readonly BillingStatus[] = [
  'Current',
  'Overdue',
  'On Hold',
  'Closed',
] as const;

export type GuardianRelationship =
  | 'Mother'
  | 'Father'
  | 'Grandparent'
  | 'Legal Guardian'
  | 'Sibling'
  | 'Other';

export const GUARDIAN_RELATIONSHIP_VALUES: readonly GuardianRelationship[] = [
  'Mother',
  'Father',
  'Grandparent',
  'Legal Guardian',
  'Sibling',
  'Other',
] as const;

export type ContactMethod =
  | 'Email'
  | 'Phone'
  | 'SMS'
  | 'WhatsApp';

export const CONTACT_METHOD_VALUES: readonly ContactMethod[] = [
  'Email',
  'Phone',
  'SMS',
  'WhatsApp',
] as const;

export type Gender =
  | 'Male'
  | 'Female'
  | 'Other'
  | 'Prefer Not To Say';

export const GENDER_VALUES: readonly Gender[] = [
  'Male',
  'Female',
  'Other',
  'Prefer Not To Say',
] as const;

export type StudentStatus =
  | 'Prospective'
  | 'Active'
  | 'On Hold'
  | 'Withdrawn'
  | 'Graduated'
  | 'Alumni';

export const STUDENT_STATUS_VALUES: readonly StudentStatus[] = [
  'Prospective',
  'Active',
  'On Hold',
  'Withdrawn',
  'Graduated',
  'Alumni',
] as const;

export type TeacherEmploymentType =
  | 'Full Time'
  | 'Part Time'
  | 'Contract'
  | 'Visiting';

export const TEACHER_EMPLOYMENT_TYPE_VALUES: readonly TeacherEmploymentType[] = [
  'Full Time',
  'Part Time',
  'Contract',
  'Visiting',
] as const;

export type TeacherStatus =
  | 'Active'
  | 'On Leave'
  | 'Inactive';

export const TEACHER_STATUS_VALUES: readonly TeacherStatus[] = [
  'Active',
  'On Leave',
  'Inactive',
] as const;

export type TermStatus =
  | 'Planned'
  | 'Open'
  | 'In Progress'
  | 'Closed'
  | 'Archived';

export const TERM_STATUS_VALUES: readonly TermStatus[] = [
  'Planned',
  'Open',
  'In Progress',
  'Closed',
  'Archived',
] as const;

export type CatalogStatus =
  | 'Draft'
  | 'Active'
  | 'Inactive'
  | 'Retired';

export const CATALOG_STATUS_VALUES: readonly CatalogStatus[] = [
  'Draft',
  'Active',
  'Inactive',
  'Retired',
] as const;

export type AcademicLevel =
  | 'Foundation'
  | 'Beginner'
  | 'Intermediate'
  | 'Advanced'
  | 'Professional';

export const ACADEMIC_LEVEL_VALUES: readonly AcademicLevel[] = [
  'Foundation',
  'Beginner',
  'Intermediate',
  'Advanced',
  'Professional',
] as const;

export type AdmissionStage =
  | 'Enquiry'
  | 'Application Submitted'
  | 'Documents Pending'
  | 'Interview'
  | 'Offered'
  | 'Accepted'
  | 'Enrolled'
  | 'Rejected'
  | 'Withdrawn';

export const ADMISSION_STAGE_VALUES: readonly AdmissionStage[] = [
  'Enquiry',
  'Application Submitted',
  'Documents Pending',
  'Interview',
  'Offered',
  'Accepted',
  'Enrolled',
  'Rejected',
  'Withdrawn',
] as const;

export type AdmissionSource =
  | 'Walk In'
  | 'Website'
  | 'Referral'
  | 'Social Media'
  | 'Agent'
  | 'Event'
  | 'Other';

export const ADMISSION_SOURCE_VALUES: readonly AdmissionSource[] = [
  'Walk In',
  'Website',
  'Referral',
  'Social Media',
  'Agent',
  'Event',
  'Other',
] as const;

export type ClassStatus =
  | 'Draft'
  | 'Scheduled'
  | 'Running'
  | 'Completed'
  | 'Cancelled';

export const CLASS_STATUS_VALUES: readonly ClassStatus[] = [
  'Draft',
  'Scheduled',
  'Running',
  'Completed',
  'Cancelled',
] as const;

export type Weekday =
  | 'Monday'
  | 'Tuesday'
  | 'Wednesday'
  | 'Thursday'
  | 'Friday'
  | 'Saturday'
  | 'Sunday';

export const WEEKDAY_VALUES: readonly Weekday[] = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

export type SessionStatus =
  | 'Scheduled'
  | 'Held'
  | 'Cancelled'
  | 'Rescheduled'
  | 'Makeup';

export const SESSION_STATUS_VALUES: readonly SessionStatus[] = [
  'Scheduled',
  'Held',
  'Cancelled',
  'Rescheduled',
  'Makeup',
] as const;

export type EnrollmentStatus =
  | 'Pending'
  | 'Active'
  | 'Completed'
  | 'Dropped'
  | 'Transferred';

export const ENROLLMENT_STATUS_VALUES: readonly EnrollmentStatus[] = [
  'Pending',
  'Active',
  'Completed',
  'Dropped',
  'Transferred',
] as const;

export type PaymentStatus =
  | 'Unpaid'
  | 'Partially Paid'
  | 'Paid'
  | 'Waived'
  | 'Refunded';

export const PAYMENT_STATUS_VALUES: readonly PaymentStatus[] = [
  'Unpaid',
  'Partially Paid',
  'Paid',
  'Waived',
  'Refunded',
] as const;

export type AllocationRole =
  | 'Lead Teacher'
  | 'Assistant'
  | 'Substitute'
  | 'Observer';

export const ALLOCATION_ROLE_VALUES: readonly AllocationRole[] = [
  'Lead Teacher',
  'Assistant',
  'Substitute',
  'Observer',
] as const;

export type AllocationStatus =
  | 'Planned'
  | 'Active'
  | 'Ended'
  | 'Cancelled';

export const ALLOCATION_STATUS_VALUES: readonly AllocationStatus[] = [
  'Planned',
  'Active',
  'Ended',
  'Cancelled',
] as const;

export type AttendanceStatus =
  | 'Present'
  | 'Absent'
  | 'Late'
  | 'Excused'
  | 'Left Early';

export const ATTENDANCE_STATUS_VALUES: readonly AttendanceStatus[] = [
  'Present',
  'Absent',
  'Late',
  'Excused',
  'Left Early',
] as const;

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** Columns every table carries. */
export interface BaseRow {
  id: number;
  created_at: string;
  updated_at: string;
}

/** Family or billing unit. In Zoho this rides on the stock Contacts module, so one record is "the household plus its primary guardian". The entity is kept distinct in this spec so a future move to Accounts-as-household is a mapping change, not a remodel. */
export interface Household extends BaseRow {
  household_name: string;
  household_code?: string | null;
  primary_guardian_name: string;
  primary_guardian_relationship?: GuardianRelationship | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  secondary_guardian_name?: string | null;
  secondary_guardian_relationship?: GuardianRelationship | null;
  secondary_guardian_phone?: string | null;
  secondary_guardian_email?: string | null;
  preferred_contact_method?: ContactMethod | null;
  address_line?: string | null;
  city?: string | null;
  postcode?: string | null;
  country?: string | null;
  billing_status?: BillingStatus | null;
  notes?: string | null;
  // Rollups: present when read through v_<table>, never written.
  active_students_count?: number;
}

/** The learner. Always belongs to exactly one household. */
export interface Student extends BaseRow {
  full_name: string;
  student_code?: string | null;
  household_id: number;
  first_name: string;
  last_name: string;
  date_of_birth?: string | null;
  gender?: Gender | null;
  status: StudentStatus;
  email?: string | null;
  phone?: string | null;
  enrollment_date?: string | null;
  exit_date?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  medical_notes?: string | null;
  photo?: string | null;
  // Rollups: present when read through v_<table>, never written.
  active_enrollments_count?: number;
}

/** Teaching staff. A separate module rather than CRM users because the org holds only 2 user licences; crm_user links the minority who do have one. */
export interface Teacher extends BaseRow {
  full_name: string;
  staff_code?: string | null;
  email?: string | null;
  phone?: string | null;
  crm_user_id?: string | null;
  employment_type?: TeacherEmploymentType | null;
  specialisms?: AcademicLevel[] | null;
  status: TeacherStatus;
  joined_on?: string | null;
  notes?: string | null;
}

/** An academic term/session. Classes and enrollments are scoped to one. */
export interface Term extends BaseRow {
  name: string;
  term_code: string;
  academic_year: number;
  sequence_no?: number | null;
  start_date: string;
  end_date: string;
  enrollment_opens?: string | null;
  enrollment_closes?: string | null;
  status: TermStatus;
}

export interface Program extends BaseRow {
  name: string;
  program_code: string;
  description?: string | null;
  level?: AcademicLevel | null;
  duration_terms?: number | null;
  status: CatalogStatus;
  // Rollups: present when read through v_<table>, never written.
  courses_count?: number;
}

/** What is taught. A course has no date and no teacher -- that is a `classes` row. The Zoho module name is forced by the target org: demo3 already holds an unrelated `Courses` (CustomModule2). */
export interface Course extends BaseRow {
  name: string;
  course_code: string;
  program_id?: number | null;
  description?: string | null;
  level?: AcademicLevel | null;
  contact_hours?: number | null;
  default_capacity?: number | null;
  default_fee?: number | null;
  status: CatalogStatus;
}

/** An application. Applicant details are held inline because no student row exists until the application is accepted; `student` is back-filled then. */
export interface Admission extends BaseRow {
  name: string;
  application_no?: string | null;
  applicant_first_name: string;
  applicant_last_name: string;
  applicant_date_of_birth?: string | null;
  applicant_gender?: Gender | null;
  guardian_name?: string | null;
  guardian_phone?: string | null;
  guardian_email?: string | null;
  household_id?: number | null;
  student_id?: number | null;
  term_id: number;
  program_id?: number | null;
  source?: AdmissionSource | null;
  stage: AdmissionStage;
  applied_date: string;
  interview_date?: string | null;
  decision_date?: string | null;
  decision_by_id?: string | null;
  rejection_reason?: string | null;
  notes?: string | null;
}

/** A section/batch: course x term x weekly timetable. NOT a dated lesson -- that is `class_sessions`. Attendance never attaches here. */
export interface Class extends BaseRow {
  name: string;
  class_code: string;
  course_id: number;
  term_id: number;
  section_label?: string | null;
  primary_teacher_id?: number | null;
  room?: string | null;
  capacity: number;
  meeting_days?: Weekday[] | null;
  start_time?: string | null;
  end_time?: string | null;
  start_date: string;
  end_date: string;
  status: ClassStatus;
  // Rollups: present when read through v_<table>, never written.
  enrolled_count?: number;
  sessions_count?: number;
}

/** A single dated meeting of a class, generated from the weekly pattern on `classes`. teacher_taken records who actually ran it, which may differ from the class primary_teacher (substitutions). */
export interface ClassSession extends BaseRow {
  name: string;
  class_id: number;
  session_date: string;
  start_time?: string | null;
  end_time?: string | null;
  sequence_no?: number | null;
  teacher_taken_id?: number | null;
  status: SessionStatus;
  topic?: string | null;
  notes?: string | null;
  attendance_taken?: boolean | null;
  attendance_taken_at?: string | null;
  // Rollups: present when read through v_<table>, never written.
  present_count?: number;
  absent_count?: number;
}

/** Joins a student to a class. `course` and `term` are intentionally denormalized: Zoho COQL cannot join two hops, so "all enrollments in Term 1" is only answerable if the term sits on this record. Both are derived from `class` and kept in step by workflow (Zoho) / trigger (SQL). */
export interface Enrollment extends BaseRow {
  name: string;
  enrollment_no?: string | null;
  student_id: number;
  class_id: number;
  course_id?: number | null;
  term_id?: number | null;
  status: EnrollmentStatus;
  enrolled_on: string;
  dropped_on?: string | null;
  drop_reason?: string | null;
  fee_amount?: number | null;
  discount?: number | null;
  payment_status?: PaymentStatus | null;
  final_grade?: string | null;
  // Rollups: present when read through v_<table>, never written.
  attendance_rate?: number;
}

/** Teacher assigned to a class. class_session is NULL for a whole-term allocation and set only for a one-off substitution on that date. */
export interface Allocation extends BaseRow {
  name: string;
  allocation_no?: string | null;
  teacher_id: number;
  class_id: number;
  class_session_id?: number | null;
  role: AllocationRole;
  effective_from?: string | null;
  effective_to?: string | null;
  status: AllocationStatus;
  notes?: string | null;
}

/** One mark per enrolled student per session. `student` and `class` are denormalized off the enrollment for the same COQL reason as enrollments. Highest-volume table: students x classes-each x sessions-per-term. */
export interface Attendance extends BaseRow {
  name: string;
  attendance_no?: string | null;
  class_session_id: number;
  enrollment_id: number;
  student_id: number;
  class_id: number;
  status: AttendanceStatus;
  minutes_late?: number | null;
  marked_by_id?: number | null;
  marked_at?: string | null;
  remarks?: string | null;
}

// ---------------------------------------------------------------------------
// Table + column names
// ---------------------------------------------------------------------------

/**
 * Nothing in the app hard-codes a table or column string. Rename a field in
 * schema/model.yaml, regenerate, and a stale reference becomes a compile
 * error instead of a silently empty column.
 */
export const TABLES = {
  households: {
    table: 'households',
    columns: {
      id: 'id',
      household_name: 'household_name',
      household_code: 'household_code',
      primary_guardian_name: 'primary_guardian_name',
      primary_guardian_relationship: 'primary_guardian_relationship',
      email: 'email',
      phone: 'phone',
      mobile: 'mobile',
      secondary_guardian_name: 'secondary_guardian_name',
      secondary_guardian_relationship: 'secondary_guardian_relationship',
      secondary_guardian_phone: 'secondary_guardian_phone',
      secondary_guardian_email: 'secondary_guardian_email',
      preferred_contact_method: 'preferred_contact_method',
      address_line: 'address_line',
      city: 'city',
      postcode: 'postcode',
      country: 'country',
      billing_status: 'billing_status',
      notes: 'notes',
      active_students_count: 'active_students_count',
    },
  },
  students: {
    table: 'students',
    columns: {
      id: 'id',
      full_name: 'full_name',
      student_code: 'student_code',
      household: 'household_id',
      first_name: 'first_name',
      last_name: 'last_name',
      date_of_birth: 'date_of_birth',
      gender: 'gender',
      status: 'status',
      email: 'email',
      phone: 'phone',
      enrollment_date: 'enrollment_date',
      exit_date: 'exit_date',
      emergency_contact_name: 'emergency_contact_name',
      emergency_contact_phone: 'emergency_contact_phone',
      medical_notes: 'medical_notes',
      photo: 'photo',
      active_enrollments_count: 'active_enrollments_count',
    },
  },
  teachers: {
    table: 'teachers',
    columns: {
      id: 'id',
      full_name: 'full_name',
      staff_code: 'staff_code',
      email: 'email',
      phone: 'phone',
      crm_user: 'crm_user_id',
      employment_type: 'employment_type',
      specialisms: 'specialisms',
      status: 'status',
      joined_on: 'joined_on',
      notes: 'notes',
    },
  },
  terms: {
    table: 'terms',
    columns: {
      id: 'id',
      name: 'name',
      term_code: 'term_code',
      academic_year: 'academic_year',
      sequence_no: 'sequence_no',
      start_date: 'start_date',
      end_date: 'end_date',
      enrollment_opens: 'enrollment_opens',
      enrollment_closes: 'enrollment_closes',
      status: 'status',
    },
  },
  programs: {
    table: 'programs',
    columns: {
      id: 'id',
      name: 'name',
      program_code: 'program_code',
      description: 'description',
      level: 'level',
      duration_terms: 'duration_terms',
      status: 'status',
      courses_count: 'courses_count',
    },
  },
  courses: {
    table: 'courses',
    columns: {
      id: 'id',
      name: 'name',
      course_code: 'course_code',
      program: 'program_id',
      description: 'description',
      level: 'level',
      contact_hours: 'contact_hours',
      default_capacity: 'default_capacity',
      default_fee: 'default_fee',
      status: 'status',
    },
  },
  admissions: {
    table: 'admissions',
    columns: {
      id: 'id',
      name: 'name',
      application_no: 'application_no',
      applicant_first_name: 'applicant_first_name',
      applicant_last_name: 'applicant_last_name',
      applicant_date_of_birth: 'applicant_date_of_birth',
      applicant_gender: 'applicant_gender',
      guardian_name: 'guardian_name',
      guardian_phone: 'guardian_phone',
      guardian_email: 'guardian_email',
      household: 'household_id',
      student: 'student_id',
      term: 'term_id',
      program: 'program_id',
      source: 'source',
      stage: 'stage',
      applied_date: 'applied_date',
      interview_date: 'interview_date',
      decision_date: 'decision_date',
      decision_by: 'decision_by_id',
      rejection_reason: 'rejection_reason',
      notes: 'notes',
    },
  },
  classes: {
    table: 'classes',
    columns: {
      id: 'id',
      name: 'name',
      class_code: 'class_code',
      course: 'course_id',
      term: 'term_id',
      section_label: 'section_label',
      primary_teacher: 'primary_teacher_id',
      room: 'room',
      capacity: 'capacity',
      meeting_days: 'meeting_days',
      start_time: 'start_time',
      end_time: 'end_time',
      start_date: 'start_date',
      end_date: 'end_date',
      status: 'status',
      enrolled_count: 'enrolled_count',
      sessions_count: 'sessions_count',
    },
  },
  class_sessions: {
    table: 'class_sessions',
    columns: {
      id: 'id',
      name: 'name',
      class: 'class_id',
      session_date: 'session_date',
      start_time: 'start_time',
      end_time: 'end_time',
      sequence_no: 'sequence_no',
      teacher_taken: 'teacher_taken_id',
      status: 'status',
      topic: 'topic',
      notes: 'notes',
      attendance_taken: 'attendance_taken',
      attendance_taken_at: 'attendance_taken_at',
      present_count: 'present_count',
      absent_count: 'absent_count',
    },
  },
  enrollments: {
    table: 'enrollments',
    columns: {
      id: 'id',
      name: 'name',
      enrollment_no: 'enrollment_no',
      student: 'student_id',
      class: 'class_id',
      course: 'course_id',
      term: 'term_id',
      status: 'status',
      enrolled_on: 'enrolled_on',
      dropped_on: 'dropped_on',
      drop_reason: 'drop_reason',
      fee_amount: 'fee_amount',
      discount: 'discount',
      payment_status: 'payment_status',
      final_grade: 'final_grade',
      attendance_rate: 'attendance_rate',
    },
  },
  allocations: {
    table: 'allocations',
    columns: {
      id: 'id',
      name: 'name',
      allocation_no: 'allocation_no',
      teacher: 'teacher_id',
      class: 'class_id',
      class_session: 'class_session_id',
      role: 'role',
      effective_from: 'effective_from',
      effective_to: 'effective_to',
      status: 'status',
      notes: 'notes',
    },
  },
  attendance: {
    table: 'attendance',
    columns: {
      id: 'id',
      name: 'name',
      attendance_no: 'attendance_no',
      class_session: 'class_session_id',
      enrollment: 'enrollment_id',
      student: 'student_id',
      class: 'class_id',
      status: 'status',
      minutes_late: 'minutes_late',
      marked_by: 'marked_by_id',
      marked_at: 'marked_at',
      remarks: 'remarks',
    },
  },
} as const;

export type TableName = keyof typeof TABLES;

// ---------------------------------------------------------------------------
// Field metadata
// ---------------------------------------------------------------------------

/**
 * Enough about each column to build a form for it without hand-writing one.
 *
 * The admin page renders from this, so a field added to schema/model.yaml
 * shows up in the UI on the next `npm run gen` with no component change.
 */
export interface FieldMeta {
  column: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'boolean' | 'date' | 'datetime' | 'time'
      | 'enum' | 'multi_enum' | 'reference' | 'autonumber' | 'email' | 'phone' | 'url';
  required: boolean;
  /** Picklist values, for enum and multi_enum. */
  options?: readonly string[];
  /** Target table, for reference. */
  ref?: TableName;
  /** Which column of the target row to show. */
  refLabel?: string;
  note?: string;
}

export const FIELDS: Record<TableName, readonly FieldMeta[]> = {
  households: [
    { column: 'household_name', label: "Household Name", type: 'text', required: true, note: "Stock Zoho display field. Holds e.g. 'Rahman Family'." },
    { column: 'household_code', label: "Household Code", type: 'autonumber', required: false },
    { column: 'primary_guardian_name', label: "Primary Guardian", type: 'text', required: true },
    { column: 'primary_guardian_relationship', label: "Primary Guardian Rel", type: 'enum', required: false, options: GUARDIAN_RELATIONSHIP_VALUES },
    { column: 'email', label: "Email", type: 'email', required: false },
    { column: 'phone', label: "Phone", type: 'phone', required: false },
    { column: 'mobile', label: "Mobile", type: 'phone', required: false },
    { column: 'secondary_guardian_name', label: "Secondary Guardian", type: 'text', required: false },
    { column: 'secondary_guardian_relationship', label: "Secondary Guardian Rel", type: 'enum', required: false, options: GUARDIAN_RELATIONSHIP_VALUES },
    { column: 'secondary_guardian_phone', label: "Secondary Guardian Phone", type: 'phone', required: false },
    { column: 'secondary_guardian_email', label: "Secondary Guardian Email", type: 'email', required: false },
    { column: 'preferred_contact_method', label: "Preferred Contact Method", type: 'enum', required: false, options: CONTACT_METHOD_VALUES },
    { column: 'address_line', label: "Address", type: 'text', required: false, note: "Zoho stock Mailing_Street is text, not textarea." },
    { column: 'city', label: "City", type: 'text', required: false },
    { column: 'postcode', label: "Postcode", type: 'text', required: false },
    { column: 'country', label: "Country", type: 'text', required: false },
    { column: 'billing_status', label: "Billing Status", type: 'enum', required: false, options: BILLING_STATUS_VALUES },
    { column: 'notes', label: "Household Notes", type: 'textarea', required: false, note: "api_name is not 'Notes' -- Zoho reserves that keyword." },
  ],
  students: [
    { column: 'full_name', label: "Student Name", type: 'text', required: true, note: "Stock display field. Keep in step with first_name + last_name." },
    { column: 'student_code', label: "Student Code", type: 'autonumber', required: false },
    { column: 'household_id', label: "Household", type: 'reference', required: true, ref: 'households', refLabel: 'household_name' },
    { column: 'first_name', label: "First Name", type: 'text', required: true },
    { column: 'last_name', label: "Last Name", type: 'text', required: true },
    { column: 'date_of_birth', label: "Date of Birth", type: 'date', required: false },
    { column: 'gender', label: "Gender", type: 'enum', required: false, options: GENDER_VALUES },
    { column: 'status', label: "Status", type: 'enum', required: true, options: STUDENT_STATUS_VALUES },
    { column: 'email', label: "Email", type: 'email', required: false },
    { column: 'phone', label: "Phone", type: 'phone', required: false },
    { column: 'enrollment_date', label: "Enrollment Date", type: 'date', required: false },
    { column: 'exit_date', label: "Exit Date", type: 'date', required: false },
    { column: 'emergency_contact_name', label: "Emergency Contact", type: 'text', required: false },
    { column: 'emergency_contact_phone', label: "Emergency Contact Phone", type: 'phone', required: false },
    { column: 'medical_notes', label: "Medical Notes", type: 'textarea', required: false },
    { column: 'photo', label: "Student Photo", type: 'text', required: false },
  ],
  teachers: [
    { column: 'full_name', label: "Teacher Name", type: 'text', required: true },
    { column: 'staff_code', label: "Staff Code", type: 'autonumber', required: false },
    { column: 'email', label: "Email", type: 'email', required: false, note: "Stock field: every Zoho custom module ships with Email + Secondary_Email. Creating it returns DUPLICATE_DATA (hit 2026-09-19 on Teachers)." },
    { column: 'phone', label: "Phone", type: 'phone', required: false },
    { column: 'crm_user_id', label: "CRM User", type: 'text', required: false, note: "Null for unlicensed staff. Set only when the teacher has a CRM seat." },
    { column: 'employment_type', label: "Employment Type", type: 'enum', required: false, options: TEACHER_EMPLOYMENT_TYPE_VALUES },
    { column: 'specialisms', label: "Specialisms", type: 'multi_enum', required: false, options: ACADEMIC_LEVEL_VALUES },
    { column: 'status', label: "Status", type: 'enum', required: true, options: TEACHER_STATUS_VALUES },
    { column: 'joined_on', label: "Joined On", type: 'date', required: false },
    { column: 'notes', label: "Teacher Notes", type: 'textarea', required: false, note: "api_name is not 'Notes' -- Zoho reserves that keyword." },
  ],
  terms: [
    { column: 'name', label: "Term Name", type: 'text', required: true, note: "e.g. '2026 Term 1'" },
    { column: 'term_code', label: "Term Code", type: 'text', required: true, note: "e.g. '2026T1'" },
    { column: 'academic_year', label: "Academic Year", type: 'number', required: true },
    { column: 'sequence_no', label: "Sequence", type: 'number', required: false, note: "Order within the academic year: 1, 2, 3..." },
    { column: 'start_date', label: "Start Date", type: 'date', required: true },
    { column: 'end_date', label: "End Date", type: 'date', required: true },
    { column: 'enrollment_opens', label: "Enrollment Opens", type: 'date', required: false },
    { column: 'enrollment_closes', label: "Enrollment Closes", type: 'date', required: false },
    { column: 'status', label: "Status", type: 'enum', required: true, options: TERM_STATUS_VALUES },
  ],
  programs: [
    { column: 'name', label: "Program Name", type: 'text', required: true },
    { column: 'program_code', label: "Program Code", type: 'text', required: true },
    { column: 'description', label: "Description", type: 'textarea', required: false },
    { column: 'level', label: "Level", type: 'enum', required: false, options: ACADEMIC_LEVEL_VALUES },
    { column: 'duration_terms', label: "Duration (Terms)", type: 'number', required: false },
    { column: 'status', label: "Status", type: 'enum', required: true, options: CATALOG_STATUS_VALUES },
  ],
  courses: [
    { column: 'name', label: "Course Name", type: 'text', required: true },
    { column: 'course_code', label: "Course Code", type: 'text', required: true },
    { column: 'program_id', label: "Program", type: 'reference', required: false, ref: 'programs', refLabel: 'name' },
    { column: 'description', label: "Description", type: 'textarea', required: false },
    { column: 'level', label: "Level", type: 'enum', required: false, options: ACADEMIC_LEVEL_VALUES },
    { column: 'contact_hours', label: "Contact Hours", type: 'number', required: false },
    { column: 'default_capacity', label: "Default Capacity", type: 'number', required: false },
    { column: 'default_fee', label: "Default Fee", type: 'number', required: false },
    { column: 'status', label: "Status", type: 'enum', required: true, options: CATALOG_STATUS_VALUES },
  ],
  admissions: [
    { column: 'name', label: "Application Name", type: 'text', required: true, note: "Zoho stock display field -- always text, so it cannot BE the auto-number. Workflow-composed from application_no." },
    { column: 'application_no', label: "Application No", type: 'autonumber', required: false },
    { column: 'applicant_first_name', label: "Applicant First Name", type: 'text', required: true },
    { column: 'applicant_last_name', label: "Applicant Last Name", type: 'text', required: true },
    { column: 'applicant_date_of_birth', label: "Applicant Date of Birth", type: 'date', required: false },
    { column: 'applicant_gender', label: "Applicant Gender", type: 'enum', required: false, options: GENDER_VALUES },
    { column: 'guardian_name', label: "Guardian Name", type: 'text', required: false },
    { column: 'guardian_phone', label: "Guardian Phone", type: 'phone', required: false },
    { column: 'guardian_email', label: "Guardian Email", type: 'email', required: false },
    { column: 'household_id', label: "Household", type: 'reference', required: false, ref: 'households', refLabel: 'household_name', note: "Linked once an existing family is matched, or created on acceptance." },
    { column: 'student_id', label: "Student", type: 'reference', required: false, ref: 'students', refLabel: 'full_name', note: "Back-filled when the application is accepted." },
    { column: 'term_id', label: "Applying For Term", type: 'reference', required: true, ref: 'terms', refLabel: 'name' },
    { column: 'program_id', label: "Program", type: 'reference', required: false, ref: 'programs', refLabel: 'name' },
    { column: 'source', label: "Source", type: 'enum', required: false, options: ADMISSION_SOURCE_VALUES },
    { column: 'stage', label: "Stage", type: 'enum', required: true, options: ADMISSION_STAGE_VALUES },
    { column: 'applied_date', label: "Applied Date", type: 'date', required: true },
    { column: 'interview_date', label: "Interview Date", type: 'datetime', required: false },
    { column: 'decision_date', label: "Decision Date", type: 'date', required: false },
    { column: 'decision_by_id', label: "Decision By", type: 'text', required: false },
    { column: 'rejection_reason', label: "Rejection Reason", type: 'textarea', required: false },
    { column: 'notes', label: "Admission Notes", type: 'textarea', required: false, note: "api_name is not 'Notes' -- Zoho reserves that keyword." },
  ],
  classes: [
    { column: 'name', label: "Class Name", type: 'text', required: true, note: "e.g. 'MATH101 - 2026T1 - A'" },
    { column: 'class_code', label: "Class Code", type: 'text', required: true },
    { column: 'course_id', label: "Course", type: 'reference', required: true, ref: 'courses', refLabel: 'name' },
    { column: 'term_id', label: "Term", type: 'reference', required: true, ref: 'terms', refLabel: 'name' },
    { column: 'section_label', label: "Section", type: 'text', required: false, note: "e.g. 'A', 'B', 'Evening'" },
    { column: 'primary_teacher_id', label: "Primary Teacher", type: 'reference', required: false, ref: 'teachers', refLabel: 'full_name' },
    { column: 'room', label: "Room", type: 'text', required: false },
    { column: 'capacity', label: "Capacity", type: 'number', required: true },
    { column: 'meeting_days', label: "Meeting Days", type: 'multi_enum', required: false, options: WEEKDAY_VALUES, note: "The weekly pattern that class_sessions rows are generated from." },
    { column: 'start_time', label: "Start Time", type: 'time', required: false },
    { column: 'end_time', label: "End Time", type: 'time', required: false },
    { column: 'start_date', label: "Start Date", type: 'date', required: true },
    { column: 'end_date', label: "End Date", type: 'date', required: true },
    { column: 'status', label: "Status", type: 'enum', required: true, options: CLASS_STATUS_VALUES },
  ],
  class_sessions: [
    { column: 'name', label: "Session Name", type: 'text', required: true, note: "Auto-composed: '<class_code> - <session_date>'" },
    { column: 'class_id', label: "Class", type: 'reference', required: true, ref: 'classes', refLabel: 'name' },
    { column: 'session_date', label: "Session Date", type: 'date', required: true },
    { column: 'start_time', label: "Start Time", type: 'time', required: false },
    { column: 'end_time', label: "End Time", type: 'time', required: false },
    { column: 'sequence_no', label: "Session No", type: 'number', required: false, note: "1-based ordinal within the class." },
    { column: 'teacher_taken_id', label: "Teacher Who Took Class", type: 'reference', required: false, ref: 'teachers', refLabel: 'full_name' },
    { column: 'status', label: "Status", type: 'enum', required: true, options: SESSION_STATUS_VALUES },
    { column: 'topic', label: "Topic", type: 'text', required: false },
    { column: 'notes', label: "Session Notes", type: 'textarea', required: false, note: "api_name is not 'Notes' -- Zoho reserves that keyword." },
    { column: 'attendance_taken', label: "Attendance Taken", type: 'boolean', required: false },
    { column: 'attendance_taken_at', label: "Attendance Taken At", type: 'datetime', required: false },
  ],
  enrollments: [
    { column: 'name', label: "Enrollment Name", type: 'text', required: true, note: "Zoho stock display field -- always text, so it cannot BE the auto-number. Workflow-composed from enrollment_no." },
    { column: 'enrollment_no', label: "Enrollment No", type: 'autonumber', required: false },
    { column: 'student_id', label: "Student", type: 'reference', required: true, ref: 'students', refLabel: 'full_name' },
    { column: 'class_id', label: "Class", type: 'reference', required: true, ref: 'classes', refLabel: 'name' },
    { column: 'course_id', label: "Course", type: 'reference', required: false, ref: 'courses', refLabel: 'name' },
    { column: 'term_id', label: "Term", type: 'reference', required: false, ref: 'terms', refLabel: 'name' },
    { column: 'status', label: "Status", type: 'enum', required: true, options: ENROLLMENT_STATUS_VALUES },
    { column: 'enrolled_on', label: "Enrolled On", type: 'date', required: true },
    { column: 'dropped_on', label: "Dropped On", type: 'date', required: false },
    { column: 'drop_reason', label: "Drop Reason", type: 'textarea', required: false },
    { column: 'fee_amount', label: "Fee Amount", type: 'number', required: false },
    { column: 'discount', label: "Discount", type: 'number', required: false },
    { column: 'payment_status', label: "Payment Status", type: 'enum', required: false, options: PAYMENT_STATUS_VALUES },
    { column: 'final_grade', label: "Final Grade", type: 'text', required: false },
  ],
  allocations: [
    { column: 'name', label: "Allocation Name", type: 'text', required: true, note: "Zoho stock display field -- always text, so it cannot BE the auto-number. Workflow-composed from allocation_no." },
    { column: 'allocation_no', label: "Allocation No", type: 'autonumber', required: false },
    { column: 'teacher_id', label: "Teacher", type: 'reference', required: true, ref: 'teachers', refLabel: 'full_name' },
    { column: 'class_id', label: "Class", type: 'reference', required: true, ref: 'classes', refLabel: 'name' },
    { column: 'class_session_id', label: "Class Session", type: 'reference', required: false, ref: 'class_sessions', refLabel: 'name', note: "NULL = allocation covers the whole class. Set = single-session substitution." },
    { column: 'role', label: "Role", type: 'enum', required: true, options: ALLOCATION_ROLE_VALUES },
    { column: 'effective_from', label: "Effective From", type: 'date', required: false },
    { column: 'effective_to', label: "Effective To", type: 'date', required: false },
    { column: 'status', label: "Status", type: 'enum', required: true, options: ALLOCATION_STATUS_VALUES },
    { column: 'notes', label: "Allocation Notes", type: 'textarea', required: false, note: "api_name is not 'Notes' -- Zoho reserves that keyword." },
  ],
  attendance: [
    { column: 'name', label: "Attendance Name", type: 'text', required: true, note: "Zoho stock display field -- always text, so it cannot BE the auto-number. Workflow-composed from attendance_no." },
    { column: 'attendance_no', label: "Attendance No", type: 'autonumber', required: false },
    { column: 'class_session_id', label: "Class Session", type: 'reference', required: true, ref: 'class_sessions', refLabel: 'name' },
    { column: 'enrollment_id', label: "Enrollment", type: 'reference', required: true, ref: 'enrollments', refLabel: 'name' },
    { column: 'student_id', label: "Student", type: 'reference', required: true, ref: 'students', refLabel: 'full_name' },
    { column: 'class_id', label: "Class", type: 'reference', required: true, ref: 'classes', refLabel: 'name' },
    { column: 'status', label: "Attendance", type: 'enum', required: true, options: ATTENDANCE_STATUS_VALUES },
    { column: 'minutes_late', label: "Minutes Late", type: 'number', required: false },
    { column: 'marked_by_id', label: "Marked By", type: 'reference', required: false, ref: 'teachers', refLabel: 'full_name', note: "The teacher who took the class and recorded the mark." },
    { column: 'marked_at', label: "Marked At", type: 'datetime', required: false },
    { column: 'remarks', label: "Remarks", type: 'textarea', required: false },
  ],
};

/** The column that best names a row of each table, for pickers and lists. */
export const DISPLAY_COLUMN: Record<TableName, string> = {
  households: 'household_name',
  students: 'full_name',
  teachers: 'full_name',
  terms: 'name',
  programs: 'name',
  courses: 'name',
  admissions: 'name',
  classes: 'name',
  class_sessions: 'name',
  enrollments: 'name',
  allocations: 'name',
  attendance: 'name',
};

/** Human labels, singular and plural. */
export const TABLE_LABELS: Record<TableName, { one: string; many: string }> = {
  households: { one: "Household", many: "Households" },
  students: { one: "Student", many: "Students" },
  teachers: { one: "Teacher", many: "Teachers" },
  terms: { one: "Term", many: "Terms" },
  programs: { one: "Program", many: "Programs" },
  courses: { one: "Course", many: "Courses" },
  admissions: { one: "Admission", many: "Admissions" },
  classes: { one: "Class", many: "Classes" },
  class_sessions: { one: "Class Session", many: "Class Sessions" },
  enrollments: { one: "Enrollment", many: "Enrollments" },
  allocations: { one: "Allocation", many: "Allocations" },
  attendance: { one: "Attendance", many: "Attendance" },
};

/** Row type per table name, so a query can be typed by the table it reads. */
export interface RowTypes {
  households: Household;
  students: Student;
  teachers: Teacher;
  terms: Term;
  programs: Program;
  courses: Course;
  admissions: Admission;
  classes: Class;
  class_sessions: ClassSession;
  enrollments: Enrollment;
  allocations: Allocation;
  attendance: Attendance;
}
