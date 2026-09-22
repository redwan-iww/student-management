// Domain reads and writes.
//
// Replaces the Zoho client of the same name. The function names are unchanged
// so the components read the same; what differs underneath is the record shape:
//
//   Zoho            { Session_Date: '…', Class: { id, name } }
//   here            { session_date: '…', class_id: 4 }
//
// A reference is now an integer id, so a name for display has to be fetched or
// joined rather than arriving free on the lookup. Helpers below do that where
// the UI needs it.

import {
  TABLES,
  type AllocationRole,
  type AttendanceStatus,
  type Class,
  type ClassSession,
  type Enrollment,
  type Student,
  type Teacher,
  type Term,
  type Attendance,
  type Allocation,
} from '../generated/db-types';
import { insert, select, selectOne, update, type Filters } from './api';

export { describeError } from './api';
export type { Class, ClassSession, Enrollment, Student, Teacher, Term, Attendance, Allocation };

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/**
 * Zoho datetime formatting is gone -- SQL takes ISO-8601 directly, and the
 * schema stores timestamps as TEXT in exactly that form.
 */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * The org's timezone, not the browser's.
 *
 * A teacher whose laptop clock is set elsewhere would otherwise compute a
 * different "today". Attendance is a statement about the school's day, so the
 * school's calendar is the one that counts.
 */
export const ORG_TIME_ZONE = 'Asia/Dhaka';

export function orgToday(now: Date = new Date()): string {
  // en-CA formats as yyyy-MM-dd, which is the shape the date columns use.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ORG_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function isFutureDate(isoDate: string, today: string = orgToday()): boolean {
  return Boolean(isoDate) && isoDate > today;
}

/**
 * Statuses that may be recorded before a lesson has happened.
 *
 * Present, Absent, Late and Left Early are observations -- they assert
 * something that was seen. Excused is a decision: a guardian saying "she will
 * be away on the 9th" is legitimate to record in advance.
 */
export const FUTURE_ALLOWED_STATUSES: readonly AttendanceStatus[] = ['Excused'];

/** id -> display name, for the lookups the UI shows by name. */
export type NameMap = Map<number, string>;

function nameMapOf<T extends { id: number }>(rows: T[], pick: (row: T) => string): NameMap {
  return new Map(rows.map((r) => [r.id, pick(r)]));
}

// ---------------------------------------------------------------------------
// Catalog / calendar
// ---------------------------------------------------------------------------

/** Terms worth showing: open for enrollment or running. */
export async function getActiveTerms(): Promise<Term[]> {
  // PostgREST has no OR across columns without an `or=` group, and two statuses
  // is a short list, so `in` says it more plainly.
  return select('terms', {
    status: 'in.(Open,In Progress)',
    order: 'start_date.asc',
  });
}

export function getClassesForTerm(termId: number): Promise<Class[]> {
  return select('classes', { term_id: `eq.${termId}`, order: 'name.asc' });
}

export function getTeachers(): Promise<Teacher[]> {
  return select('teachers', { status: 'eq.Active', order: 'full_name.asc' });
}

export async function getTermNames(ids: number[]): Promise<NameMap> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return new Map();
  const rows = await select('terms', { id: `in.(${unique.join(',')})` });
  return nameMapOf(rows, (t) => t.name);
}

export async function getClassesByIds(ids: number[]): Promise<Map<number, Class>> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return new Map();
  const rows = await select('classes', { id: `in.(${unique.join(',')})` });
  return new Map(rows.map((c) => [c.id, c]));
}

// ---------------------------------------------------------------------------
// Class Allocation
// ---------------------------------------------------------------------------

export function getAllocationsForClass(classId: number): Promise<Allocation[]> {
  return select('allocations', { class_id: `eq.${classId}` });
}

export interface NewAllocation {
  teacherId: number;
  classId: number;
  role: AllocationRole;
  /** Class code or name, used to compose the Name column. */
  classLabel: string;
  effectiveFrom?: string;
}

export async function createAllocation(a: NewAllocation): Promise<Allocation> {
  const rows = await insert('allocations', {
    name: `${a.role} - ${a.classLabel}`,
    teacher_id: a.teacherId,
    class_id: a.classId,
    role: a.role,
    status: 'Active',
    effective_from: a.effectiveFrom ?? orgToday(),
  });
  return rows[0]!;
}

export async function endAllocation(allocationId: number): Promise<void> {
  await update('allocations', allocationId, {
    status: 'Ended',
    effective_to: orgToday(),
  });
}

/**
 * Sets the class's headline teacher. null clears it -- needed when the last
 * lead allocation ends, or the class would keep showing a teacher who is no
 * longer assigned to it.
 */
export async function setPrimaryTeacher(
  classId: number,
  teacherId: number | null,
): Promise<void> {
  await update('classes', classId, { primary_teacher_id: teacherId });
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export function getSessionsForDate(isoDate: string): Promise<ClassSession[]> {
  return select('class_sessions', {
    session_date: `eq.${isoDate}`,
    order: 'start_time.asc',
  });
}

export function getClassSession(sessionId: number): Promise<ClassSession | null> {
  return selectOne('class_sessions', sessionId);
}

export function getEnrollmentsForClass(classId: number): Promise<Enrollment[]> {
  return select('enrollments', { class_id: `eq.${classId}`, status: 'eq.Active' });
}

export async function getStudentNames(ids: number[]): Promise<NameMap> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return new Map();
  const rows = await select('students', { id: `in.(${unique.join(',')})` });
  return nameMapOf(rows, (s) => s.full_name);
}

/** Attendance already recorded for a session, keyed by enrollment id. */
export async function getAttendanceForSession(
  sessionId: number,
): Promise<Map<number, Attendance>> {
  const rows = await select('attendance', { class_session_id: `eq.${sessionId}` });
  return new Map(rows.map((a) => [a.enrollment_id, a]));
}

export interface AttendanceMark {
  enrollmentId: number;
  studentId: number;
  classId: number;
  status: AttendanceStatus;
  studentName: string;
  /** Present when updating an existing mark rather than creating one. */
  existingId?: number;
}

/**
 * Writes one mark.
 *
 * Upsert by hand because (enrollment, class_session) is enforced by a UNIQUE
 * constraint rather than an ON CONFLICT clause the client controls.
 */
export async function saveMark(
  sessionId: number,
  mark: AttendanceMark,
  markedByTeacherId: number | null,
  sessionLabel: string,
): Promise<void> {
  const payload = {
    name: `${mark.studentName} - ${sessionLabel}`,
    class_session_id: sessionId,
    enrollment_id: mark.enrollmentId,
    student_id: mark.studentId,
    class_id: mark.classId,
    status: mark.status,
    marked_at: nowIso(),
    ...(markedByTeacherId ? { marked_by_id: markedByTeacherId } : {}),
  };

  if (mark.existingId) {
    await update('attendance', mark.existingId, payload);
    return;
  }
  await insert('attendance', payload);
}

/** Flags the session as done, so a half-finished sheet is distinguishable. */
export async function markSessionAttendanceTaken(
  sessionId: number,
  teacherId: number | null,
  markHeld = true,
): Promise<void> {
  await update('class_sessions', sessionId, {
    attendance_taken: true,
    attendance_taken_at: nowIso(),
    // Never call a future lesson 'Held' -- that asserts it already happened.
    ...(markHeld ? { status: 'Held' as const } : {}),
    ...(teacherId ? { teacher_taken_id: teacherId } : {}),
  });
}

// ---------------------------------------------------------------------------
// Timetable generation
// ---------------------------------------------------------------------------

const WEEKDAY_INDEX = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
} as const;

/**
 * Expands a class's weekly pattern into the dated meetings it implies.
 *
 * Pure -- no I/O -- so the arithmetic is testable and the caller decides what
 * to write. Returns [] when the class has no meeting days or no date range,
 * rather than guessing a pattern.
 */
export function plannedSessions(klass: Class): Array<{ date: string; sequenceNo: number }> {
  const days = klass.meeting_days;
  const start = str(klass.start_date);
  const end = str(klass.end_date);
  if (!Array.isArray(days) || days.length === 0 || !start || !end) return [];

  const wanted = new Set<number>(
    days.map((d) => WEEKDAY_INDEX[d as keyof typeof WEEKDAY_INDEX] as number | undefined)
      .filter((n): n is number => n !== undefined),
  );
  if (wanted.size === 0) return [];

  const out: Array<{ date: string; sequenceNo: number }> = [];
  const last = new Date(`${end}T00:00:00Z`);
  const cursor = new Date(`${start}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime())) return [];

  while (cursor <= last) {
    if (wanted.has(cursor.getUTCDay())) {
      out.push({ date: cursor.toISOString().slice(0, 10), sequenceNo: out.length + 1 });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/** Sessions already recorded for a class, as a set of "date|start_time" keys. */
export async function getSessionKeysForClass(classId: number): Promise<Set<string>> {
  const rows = await select('class_sessions', { class_id: `eq.${classId}` });
  return new Set(rows.map((r) => `${str(r.session_date)}|${str(r.start_time)}`));
}

/**
 * Batch size for a bulk insert.
 *
 * SQLite has no 100-row ceiling the way the CRM API did, but batching still
 * bounds the request body and keeps progress reporting meaningful.
 */
export const BULK_LIMIT = 200;

export interface PlannedSession {
  klass: Class;
  date: string;
  sequenceNo: number;
}

export async function createClassSessionBatch(batch: PlannedSession[]): Promise<number> {
  if (batch.length === 0) return 0;
  const rows = await insert(
    'class_sessions',
    batch.map((item) => ({
      name: `${str(item.klass.class_code, str(item.klass.name))} - ${item.date}`,
      class_id: item.klass.id,
      session_date: item.date,
      start_time: item.klass.start_time ?? null,
      end_time: item.klass.end_time ?? null,
      sequence_no: item.sequenceNo,
      status: 'Scheduled' as const,
      attendance_taken: false,
    })),
  );
  return rows.length;
}

export { TABLES };
export type { Filters };
