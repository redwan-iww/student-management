// GENERATED FILE -- do not edit.
// Source: schema/model.yaml + schema/enums.yaml   (npm run gen:types)

/** A Zoho lookup value as returned by the API. */
export interface ZohoRef {
  id: string;
  name?: string;
}

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

export type HolidayKind =
  | 'Public Holiday'
  | 'Religious Holiday'
  | 'School Closure'
  | 'Term Break'
  | 'Exam Period'
  | 'Other';

export const HOLIDAY_KIND_VALUES: readonly HolidayKind[] = [
  'Public Holiday',
  'Religious Holiday',
  'School Closure',
  'Term Break',
  'Exam Period',
  'Other',
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
// Records
// ---------------------------------------------------------------------------

/**
 * Family or billing unit. In Zoho this rides on the stock Contacts module, so one record is "the household plus its primary guardian". The entity is kept distinct in this spec so a future move to Accounts-as-household is a mapping change, not a remodel.
 * Zoho module: Contacts
 */
export interface Household {
  id: string;
  household_name: string;
  household_code?: string;
  primary_guardian_name: string;
  primary_guardian_relationship?: GuardianRelationship;
  email?: string;
  phone?: string;
  mobile?: string;
  secondary_guardian_name?: string;
  secondary_guardian_relationship?: GuardianRelationship;
  secondary_guardian_phone?: string;
  secondary_guardian_email?: string;
  preferred_contact_method?: ContactMethod;
  address_line?: string;
  city?: string;
  postcode?: string;
  country?: string;
  billing_status?: BillingStatus;
  notes?: string;
  readonly active_students_count?: number;
}

/**
 * The learner. Always belongs to exactly one household.
 * Zoho module: Students
 */
export interface Student {
  id: string;
  full_name: string;
  student_code?: string;
  household: ZohoRef;
  first_name: string;
  last_name: string;
  date_of_birth?: string;
  gender?: Gender;
  status: StudentStatus;
  email?: string;
  phone?: string;
  enrollment_date?: string;
  exit_date?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  medical_notes?: string;
  photo?: string;
  readonly active_enrollments_count?: number;
}

/**
 * Teaching staff. A separate module rather than CRM users because the org holds only 2 user licences; crm_user links the minority who do have one.
 * Zoho module: Teachers
 */
export interface Teacher {
  id: string;
  full_name: string;
  staff_code?: string;
  email?: string;
  phone?: string;
  crm_user?: string;
  employment_type?: TeacherEmploymentType;
  specialisms?: AcademicLevel[];
  status: TeacherStatus;
  joined_on?: string;
  notes?: string;
}

/**
 * An academic term/session. Classes and enrollments are scoped to one.
 * Zoho module: Terms
 */
export interface Term {
  id: string;
  name: string;
  term_code: string;
  academic_year: number;
  sequence_no?: number;
  start_date: string;
  end_date: string;
  enrollment_opens?: string;
  enrollment_closes?: string;
  status: TermStatus;
}

/**
 * A date or date range on which no lesson is held. Scoped to a term when it is a term-specific closure, or left unscoped to apply across the whole calendar -- which is what a public holiday needs.
 * Zoho module: Holidays
 */
export interface Holiday {
  id: string;
  name: string;
  start_date: string;
  end_date?: string;
  term?: ZohoRef;
  kind: HolidayKind;
  notes?: string;
}

export interface Program {
  id: string;
  name: string;
  program_code: string;
  description?: string;
  level?: AcademicLevel;
  duration_terms?: number;
  status: CatalogStatus;
  readonly courses_count?: number;
}

/**
 * What is taught. A course has no date and no teacher -- that is a `classes` row. The Zoho module name is forced by the target org: demo3 already holds an unrelated `Courses` (CustomModule2).
 * Zoho module: Course_Catalog
 */
export interface Course {
  id: string;
  name: string;
  course_code: string;
  program?: ZohoRef;
  description?: string;
  level?: AcademicLevel;
  contact_hours?: number;
  default_capacity?: number;
  default_fee?: number;
  status: CatalogStatus;
}

/**
 * An application. Applicant details are held inline because no student row exists until the application is accepted; `student` is back-filled then.
 * Zoho module: Admissions
 */
export interface Admission {
  id: string;
  name: string;
  application_no?: string;
  applicant_first_name: string;
  applicant_last_name: string;
  applicant_date_of_birth?: string;
  applicant_gender?: Gender;
  guardian_name?: string;
  guardian_phone?: string;
  guardian_email?: string;
  household?: ZohoRef;
  student?: ZohoRef;
  term: ZohoRef;
  program?: ZohoRef;
  source?: AdmissionSource;
  stage: AdmissionStage;
  applied_date: string;
  interview_date?: string;
  decision_date?: string;
  decision_by?: string;
  rejection_reason?: string;
  notes?: string;
}

/**
 * A section/batch: course x term x weekly timetable. NOT a dated lesson -- that is `class_sessions`. Attendance never attaches here.
 * Zoho module: Classes
 */
export interface Class {
  id: string;
  name: string;
  class_code: string;
  course: ZohoRef;
  term: ZohoRef;
  section_label?: string;
  primary_teacher?: ZohoRef;
  room?: string;
  capacity: number;
  meeting_days?: Weekday[];
  start_time?: string;
  end_time?: string;
  start_date: string;
  end_date: string;
  status: ClassStatus;
  readonly enrolled_count?: number;
  readonly sessions_count?: number;
}

/**
 * A single dated meeting of a class, generated from the weekly pattern on `classes`. teacher_taken records who actually ran it, which may differ from the class primary_teacher (substitutions).
 * Zoho module: Class_Sessions
 */
export interface ClassSession {
  id: string;
  name: string;
  class: ZohoRef;
  session_date: string;
  start_time?: string;
  end_time?: string;
  sequence_no?: number;
  teacher_taken?: ZohoRef;
  status: SessionStatus;
  topic?: string;
  notes?: string;
  attendance_taken?: boolean;
  attendance_taken_at?: string;
  readonly present_count?: number;
  readonly absent_count?: number;
}

/**
 * Joins a student to a class. `course` and `term` are intentionally denormalized: Zoho COQL cannot join two hops, so "all enrollments in Term 1" is only answerable if the term sits on this record. Both are derived from `class` and kept in step by workflow (Zoho) / trigger (SQL).
 * Zoho module: Enrollments
 */
export interface Enrollment {
  id: string;
  name: string;
  enrollment_no?: string;
  student: ZohoRef;
  class: ZohoRef;
  course?: ZohoRef;
  term?: ZohoRef;
  status: EnrollmentStatus;
  enrolled_on: string;
  dropped_on?: string;
  drop_reason?: string;
  fee_amount?: number;
  discount?: number;
  payment_status?: PaymentStatus;
  final_grade?: string;
  readonly attendance_rate?: number;
}

/**
 * Teacher assigned to a class. class_session is NULL for a whole-term allocation and set only for a one-off substitution on that date.
 * Zoho module: Allocations
 */
export interface Allocation {
  id: string;
  name: string;
  allocation_no?: string;
  teacher: ZohoRef;
  class: ZohoRef;
  class_session?: ZohoRef;
  role: AllocationRole;
  effective_from?: string;
  effective_to?: string;
  status: AllocationStatus;
  notes?: string;
}

/**
 * One mark per enrolled student per session. `student` and `class` are denormalized off the enrollment for the same COQL reason as enrollments. Highest-volume table: students x classes-each x sessions-per-term.
 * Zoho module: Attendance
 */
export interface Attendance {
  id: string;
  name: string;
  attendance_no?: string;
  class_session: ZohoRef;
  enrollment: ZohoRef;
  student: ZohoRef;
  class: ZohoRef;
  status: AttendanceStatus;
  minutes_late?: number;
  marked_by?: ZohoRef;
  marked_at?: string;
  remarks?: string;
}

// ---------------------------------------------------------------------------
// Zoho field map
//
// Widget code should never hard-code an api_name. Go through this map so a
// rename in schema/model.yaml propagates on the next `npm run gen`.
//
//   const { module, fields } = ZOHO_MODULES.attendance;
//   ZOHO.CRM.API.insertRecord({ Entity: module, APIData: {
//     [fields.status]: "Present",
//     [fields.class_session]: { id: sessionId },
//   }});
// ---------------------------------------------------------------------------

export interface ZohoModuleMap {
  readonly module: string;
  readonly displayField: string;
  readonly fields: Readonly<Record<string, string>>;
}

export const ZOHO_MODULES = {
  households: {
    module: 'Contacts',
    displayField: 'Last_Name',
    fields: {
      household_name: 'Last_Name',
      household_code: 'Household_Code',
      primary_guardian_name: 'Primary_Guardian_Name',
      primary_guardian_relationship: 'Primary_Guardian_Relationship',
      email: 'Email',
      phone: 'Phone',
      mobile: 'Mobile',
      secondary_guardian_name: 'Secondary_Guardian_Name',
      secondary_guardian_relationship: 'Secondary_Guardian_Relationship',
      secondary_guardian_phone: 'Secondary_Guardian_Phone',
      secondary_guardian_email: 'Secondary_Guardian_Email',
      preferred_contact_method: 'Preferred_Contact_Method',
      address_line: 'Mailing_Street',
      city: 'Mailing_City',
      postcode: 'Mailing_Zip',
      country: 'Mailing_Country',
      billing_status: 'Billing_Status',
      notes: 'Household_Notes',
      active_students_count: 'Active_Students_Count',
    },
  },
  students: {
    module: 'Students',
    displayField: 'Name',
    fields: {
      full_name: 'Name',
      student_code: 'Student_Code',
      household: 'Household',
      first_name: 'First_Name',
      last_name: 'Last_Name',
      date_of_birth: 'Date_Of_Birth',
      gender: 'Gender',
      status: 'Status',
      email: 'Email',
      phone: 'Phone',
      enrollment_date: 'Enrollment_Date',
      exit_date: 'Exit_Date',
      emergency_contact_name: 'Emergency_Contact_Name',
      emergency_contact_phone: 'Emergency_Contact_Phone',
      medical_notes: 'Medical_Notes',
      photo: 'Record_Image',
      active_enrollments_count: 'Active_Enrollments_Count',
    },
  },
  teachers: {
    module: 'Teachers',
    displayField: 'Name',
    fields: {
      full_name: 'Name',
      staff_code: 'Staff_Code',
      email: 'Email',
      phone: 'Phone',
      crm_user: 'CRM_User',
      employment_type: 'Employment_Type',
      specialisms: 'Specialisms',
      status: 'Status',
      joined_on: 'Joined_On',
      notes: 'Teacher_Notes',
    },
  },
  terms: {
    module: 'Terms',
    displayField: 'Name',
    fields: {
      name: 'Name',
      term_code: 'Term_Code',
      academic_year: 'Academic_Year',
      sequence_no: 'Sequence_No',
      start_date: 'Start_Date',
      end_date: 'End_Date',
      enrollment_opens: 'Enrollment_Opens',
      enrollment_closes: 'Enrollment_Closes',
      status: 'Status',
    },
  },
  holidays: {
    module: 'Holidays',
    displayField: 'Name',
    fields: {
      name: 'Name',
      start_date: 'Start_Date',
      end_date: 'End_Date',
      term: 'Term',
      kind: 'Kind',
      notes: 'Holiday_Notes',
    },
  },
  programs: {
    module: 'Academic_Programs',
    displayField: 'Name',
    fields: {
      name: 'Name',
      program_code: 'Program_Code',
      description: 'Description',
      level: 'Level',
      duration_terms: 'Duration_Terms',
      status: 'Status',
      courses_count: 'Courses_Count',
    },
  },
  courses: {
    module: 'Course_Catalog',
    displayField: 'Name',
    fields: {
      name: 'Name',
      course_code: 'Course_Code',
      program: 'Program',
      description: 'Description',
      level: 'Level',
      contact_hours: 'Contact_Hours',
      default_capacity: 'Default_Capacity',
      default_fee: 'Default_Fee',
      status: 'Status',
    },
  },
  admissions: {
    module: 'Admissions',
    displayField: 'Name',
    fields: {
      name: 'Name',
      application_no: 'Application_No',
      applicant_first_name: 'Applicant_First_Name',
      applicant_last_name: 'Applicant_Last_Name',
      applicant_date_of_birth: 'Applicant_Date_Of_Birth',
      applicant_gender: 'Applicant_Gender',
      guardian_name: 'Guardian_Name',
      guardian_phone: 'Guardian_Phone',
      guardian_email: 'Guardian_Email',
      household: 'Household',
      student: 'Student',
      term: 'Term',
      program: 'Program',
      source: 'Source',
      stage: 'Stage',
      applied_date: 'Applied_Date',
      interview_date: 'Interview_Date',
      decision_date: 'Decision_Date',
      decision_by: 'Decision_By',
      rejection_reason: 'Rejection_Reason',
      notes: 'Admission_Notes',
    },
  },
  classes: {
    module: 'Classes',
    displayField: 'Name',
    fields: {
      name: 'Name',
      class_code: 'Class_Code',
      course: 'Course',
      term: 'Term',
      section_label: 'Section_Label',
      primary_teacher: 'Primary_Teacher',
      room: 'Room',
      capacity: 'Capacity',
      meeting_days: 'Meeting_Days',
      start_time: 'Start_Time',
      end_time: 'End_Time',
      start_date: 'Start_Date',
      end_date: 'End_Date',
      status: 'Status',
      enrolled_count: 'Enrolled_Count',
      sessions_count: 'Sessions_Count',
    },
  },
  class_sessions: {
    module: 'Class_Sessions',
    displayField: 'Name',
    fields: {
      name: 'Name',
      class: 'Class',
      session_date: 'Session_Date',
      start_time: 'Start_Time',
      end_time: 'End_Time',
      sequence_no: 'Sequence_No',
      teacher_taken: 'Teacher_Taken',
      status: 'Status',
      topic: 'Topic',
      notes: 'Session_Notes',
      attendance_taken: 'Attendance_Taken',
      attendance_taken_at: 'Attendance_Taken_At',
      present_count: 'Present_Count',
      absent_count: 'Absent_Count',
    },
  },
  enrollments: {
    module: 'Enrollments',
    displayField: 'Name',
    fields: {
      name: 'Name',
      enrollment_no: 'Enrollment_No',
      student: 'Student',
      class: 'Class',
      course: 'Course',
      term: 'Term',
      status: 'Status',
      enrolled_on: 'Enrolled_On',
      dropped_on: 'Dropped_On',
      drop_reason: 'Drop_Reason',
      fee_amount: 'Fee_Amount',
      discount: 'Discount',
      payment_status: 'Payment_Status',
      final_grade: 'Final_Grade',
      attendance_rate: 'Attendance_Rate',
    },
  },
  allocations: {
    module: 'Allocations',
    displayField: 'Name',
    fields: {
      name: 'Name',
      allocation_no: 'Allocation_No',
      teacher: 'Teacher',
      class: 'Class',
      class_session: 'Class_Session',
      role: 'Role',
      effective_from: 'Effective_From',
      effective_to: 'Effective_To',
      status: 'Status',
      notes: 'Allocation_Notes',
    },
  },
  attendance: {
    module: 'Attendance',
    displayField: 'Name',
    fields: {
      name: 'Name',
      attendance_no: 'Attendance_No',
      class_session: 'Class_Session',
      enrollment: 'Enrollment',
      student: 'Student',
      class: 'Class',
      status: 'Status',
      minutes_late: 'Minutes_Late',
      marked_by: 'Marked_By',
      marked_at: 'Marked_At',
      remarks: 'Remarks',
    },
  },
} as const satisfies Record<string, ZohoModuleMap>;

export type EntityName = keyof typeof ZOHO_MODULES;

/** Maps an entity name to its record interface. */
export interface EntityTypes {
  households: Household;
  students: Student;
  teachers: Teacher;
  terms: Term;
  holidays: Holiday;
  programs: Program;
  courses: Course;
  admissions: Admission;
  classes: Class;
  class_sessions: ClassSession;
  enrollments: Enrollment;
  allocations: Allocation;
  attendance: Attendance;
}
