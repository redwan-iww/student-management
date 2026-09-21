// Domain reads/writes, addressed through the generated ZOHO_MODULES map.
//
// Nothing here hard-codes a Zoho api_name. Rename a field in
// schema/model.yaml, re-run `npm run gen`, and a stale reference becomes a
// compile error instead of an empty column at runtime.

import {
  ZOHO_MODULES,
  type AllocationRole,
  type AttendanceStatus,
} from '../generated/types';
import { zoho, type ZohoApiResponse } from './sdk';

/** A Zoho record as it comes back: untyped bag plus a guaranteed id. */
export type RawRecord = Record<string, unknown> & { id: string };

const rows = (res: ZohoApiResponse): RawRecord[] =>
  (res.data ?? []).filter((r): r is RawRecord => typeof (r as RawRecord).id === 'string');

/** Zoho returns a lookup as { id, name } -- pull the pieces out. */
export function refId(value: unknown): string | null {
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id: unknown }).id;
    return typeof id === 'string' ? id : null;
  }
  return null;
}

export function refName(value: unknown): string {
  if (value && typeof value === 'object' && 'name' in value) {
    const n = (value as { name: unknown }).name;
    if (typeof n === 'string') return n;
  }
  return '';
}

export function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

async function search(entity: string, query: string, perPage = 200): Promise<RawRecord[]> {
  const res = await zoho().CRM.API.searchRecord({
    Entity: entity,
    Type: 'criteria',
    Query: query,
    per_page: perPage,
  });
  return rows(res);
}

function assertWrote(res: ZohoApiResponse, what: string): string {
  const detail = (res.data as unknown as Array<{ code?: string; message?: string; details?: { id?: string } }> | undefined)?.[0];
  if (detail?.code && detail.code !== 'SUCCESS') {
    throw new Error(`${detail.code}: ${detail.message ?? `${what} failed`}`);
  }
  return detail?.details?.id ?? '';
}

// ---------------------------------------------------------------------------
// Catalog / calendar
// ---------------------------------------------------------------------------

/** Terms currently worth showing: open for enrollment or running. */
export async function getActiveTerms(): Promise<RawRecord[]> {
  const { module, fields } = ZOHO_MODULES.terms;
  const recs = await search(
    module,
    `((${fields.status}:equals:Open)or(${fields.status}:equals:In Progress))`,
  );
  return recs.sort((a, b) => str(a[fields.start_date]).localeCompare(str(b[fields.start_date])));
}

export async function getClassesForTerm(termId: string): Promise<RawRecord[]> {
  const { module, fields } = ZOHO_MODULES.classes;
  const recs = await search(module, `(${fields.term}:equals:${termId})`);
  return recs.sort((a, b) => str(a[fields.name]).localeCompare(str(b[fields.name])));
}

export async function getTeachers(): Promise<RawRecord[]> {
  const { module, fields } = ZOHO_MODULES.teachers;
  const recs = await search(module, `(${fields.status}:equals:Active)`);
  return recs.sort((a, b) => str(a[fields.full_name]).localeCompare(str(b[fields.full_name])));
}

// ---------------------------------------------------------------------------
// Class Allocation tab
// ---------------------------------------------------------------------------

export async function getAllocationsForClass(classId: string): Promise<RawRecord[]> {
  const { module, fields } = ZOHO_MODULES.allocations;
  return search(module, `(${fields.class}:equals:${classId})`);
}

export interface NewAllocation {
  teacherId: string;
  classId: string;
  role: AllocationRole;
  effectiveFrom?: string;
  effectiveTo?: string;
}

export async function createAllocation(a: NewAllocation): Promise<string> {
  const { module, fields } = ZOHO_MODULES.allocations;
  const payload: Record<string, unknown> = {
    [fields.teacher]: { id: a.teacherId },
    [fields.class]: { id: a.classId },
    [fields.role]: a.role,
    [fields.status]: 'Active',
  };
  if (a.effectiveFrom) payload[fields.effective_from] = a.effectiveFrom;
  if (a.effectiveTo) payload[fields.effective_to] = a.effectiveTo;

  const res = await zoho().CRM.API.insertRecord({ Entity: module, APIData: payload, Trigger: [] });
  return assertWrote(res, 'allocation');
}

export async function endAllocation(allocationId: string): Promise<void> {
  const { module, fields } = ZOHO_MODULES.allocations;
  const res = await zoho().CRM.API.updateRecord({
    Entity: module,
    RecordID: allocationId,
    APIData: {
      [fields.status]: 'Ended',
      [fields.effective_to]: new Date().toISOString().slice(0, 10),
    },
    Trigger: [],
  });
  assertWrote(res, 'allocation update');
}

/** Sets the class's headline teacher, kept alongside the allocation records. */
export async function setPrimaryTeacher(classId: string, teacherId: string): Promise<void> {
  const { module, fields } = ZOHO_MODULES.classes;
  const res = await zoho().CRM.API.updateRecord({
    Entity: module,
    RecordID: classId,
    APIData: { [fields.primary_teacher]: { id: teacherId } },
    Trigger: [],
  });
  assertWrote(res, 'primary teacher update');
}

// ---------------------------------------------------------------------------
// Attendance Manager tab
// ---------------------------------------------------------------------------

/** Sessions on one date -- the web tab's entry point, since there is no record context. */
export async function getSessionsForDate(isoDate: string): Promise<RawRecord[]> {
  const { module, fields } = ZOHO_MODULES.class_sessions;
  const recs = await search(module, `(${fields.session_date}:equals:${isoDate})`);
  return recs.sort((a, b) => str(a[fields.start_time]).localeCompare(str(b[fields.start_time])));
}

export async function getClassSession(sessionId: string): Promise<RawRecord | null> {
  const { module } = ZOHO_MODULES.class_sessions;
  const res = await zoho().CRM.API.getRecord({ Entity: module, RecordID: sessionId });
  return rows(res)[0] ?? null;
}

/** Active enrollments for a class -- the roster the attendance sheet renders. */
export async function getEnrollmentsForClass(classId: string): Promise<RawRecord[]> {
  const { module, fields } = ZOHO_MODULES.enrollments;
  return search(module, `((${fields.class}:equals:${classId})and(${fields.status}:equals:Active))`);
}

/** Attendance already recorded for a session, keyed by enrollment id. */
export async function getAttendanceForSession(sessionId: string): Promise<Map<string, RawRecord>> {
  const { module, fields } = ZOHO_MODULES.attendance;
  const recs = await search(module, `(${fields.class_session}:equals:${sessionId})`);
  const byEnrollment = new Map<string, RawRecord>();
  for (const rec of recs) {
    const enrollmentId = refId(rec[fields.enrollment]);
    if (enrollmentId) byEnrollment.set(enrollmentId, rec);
  }
  return byEnrollment;
}

export interface AttendanceMark {
  enrollmentId: string;
  studentId: string;
  classId: string;
  status: AttendanceStatus;
  /** Present when updating an existing mark rather than creating one. */
  existingId?: string;
}

/**
 * Writes one mark. Upsert by hand because the composite key
 * (enrollment, class_session) is not a native Zoho unique constraint -- see
 * build/zoho/validations.json.
 */
export async function saveMark(
  sessionId: string,
  mark: AttendanceMark,
  markedByTeacherId: string | null,
): Promise<void> {
  const { module, fields } = ZOHO_MODULES.attendance;

  const payload: Record<string, unknown> = {
    [fields.class_session]: { id: sessionId },
    [fields.enrollment]: { id: mark.enrollmentId },
    [fields.student]: { id: mark.studentId },
    [fields.class]: { id: mark.classId },
    [fields.status]: mark.status,
    [fields.marked_at]: new Date().toISOString(),
  };
  if (markedByTeacherId) payload[fields.marked_by] = { id: markedByTeacherId };

  const api = zoho().CRM.API;
  const res = mark.existingId
    ? await api.updateRecord({ Entity: module, RecordID: mark.existingId, APIData: payload, Trigger: [] })
    : await api.insertRecord({ Entity: module, APIData: payload, Trigger: [] });

  assertWrote(res, 'attendance write');
}

/** Flags the session as done, so a half-finished sheet is distinguishable. */
export async function markSessionAttendanceTaken(
  sessionId: string,
  teacherId: string | null,
): Promise<void> {
  const { module, fields } = ZOHO_MODULES.class_sessions;
  const payload: Record<string, unknown> = {
    [fields.attendance_taken]: true,
    [fields.attendance_taken_at]: new Date().toISOString(),
    [fields.status]: 'Held',
  };
  if (teacherId) payload[fields.teacher_taken] = { id: teacherId };

  const res = await zoho().CRM.API.updateRecord({
    Entity: module,
    RecordID: sessionId,
    APIData: payload,
    Trigger: [],
  });
  assertWrote(res, 'session update');
}
