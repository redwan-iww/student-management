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

/**
 * Zoho datetime format: ISO 8601 with a UTC offset, seconds precision.
 *
 *   2026-09-22T17:30:00+06:00
 *
 * NOT what Date.prototype.toISOString() produces. That returns UTC with a 'Z'
 * suffix and milliseconds -- '2026-09-22T11:30:00.000Z' -- which Zoho rejects
 * outright as INVALID_DATA on the field. Date-only fields are unaffected;
 * they take a plain yyyy-MM-dd.
 */
export function zohoDateTime(d: Date = new Date()): string {
  const pad = (v: number) => String(Math.abs(Math.trunc(v))).padStart(2, '0');
  // getTimezoneOffset is minutes *behind* UTC, so the sign is inverted.
  const offsetMinutes = -d.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(offsetMinutes / 60)}:${pad(offsetMinutes % 60)}`
  );
}

/**
 * The org's timezone, not the browser's.
 *
 * demo3 runs Asia/Dhaka. A teacher whose laptop clock is set elsewhere would
 * otherwise compute a different "today" and could be allowed -- or blocked --
 * a day early. Attendance is a statement about the school's day, so the
 * school's calendar is the one that counts.
 */
export const ORG_TIME_ZONE = 'Asia/Dhaka';

/** Today in the org's timezone, as yyyy-MM-dd. */
export function orgToday(now: Date = new Date()): string {
  // en-CA formats as yyyy-MM-dd, which is exactly Zoho's date shape.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ORG_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** True when a session's date is still ahead of the school's today. */
export function isFutureDate(isoDate: string, today: string = orgToday()): boolean {
  return Boolean(isoDate) && isoDate > today;
}

/**
 * Statuses that may be recorded before a lesson has happened.
 *
 * Present, Absent, Late and Left Early are observations -- they assert
 * something that was seen, so they cannot be known in advance. Excused is a
 * decision, not an observation: a guardian saying "she will be away on the
 * 9th" is legitimate to record now, and schools genuinely do it.
 */
export const FUTURE_ALLOWED_STATUSES: readonly AttendanceStatus[] = ['Excused'];

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

/**
 * Turns anything thrown into something a person can act on.
 *
 * The Zoho SDK rejects with a plain object, not an Error -- so the usual
 * `err instanceof Error ? err.message : String(err)` renders it as the useless
 * "[object Object]", which is exactly how a mandatory-field rejection stayed
 * invisible until 2026-09-22. Dig out Zoho's own code/message first, including
 * the per-record shape where the real reason lives under data[0].
 */
export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;

  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>;

    // Per-record failures: { data: [{ code, message, details }] }
    const first = Array.isArray(o.data) ? (o.data[0] as Record<string, unknown> | undefined) : undefined;
    for (const src of [first, o]) {
      if (!src) continue;
      const code = typeof src.code === 'string' ? src.code : null;
      const message = typeof src.message === 'string' ? src.message : null;
      const field = (src.details as { api_name?: string } | undefined)?.api_name;
      if (code || message) {
        return [code, message, field ? `(field: ${field})` : null].filter(Boolean).join(': ');
      }
    }

    try {
      return JSON.stringify(err);
    } catch {
      /* fall through to the generic label below */
    }
  }
  return String(err);
}

/**
 * Updates one record.
 *
 * The id goes INSIDE APIData, not only in RecordID. Zoho's SDK reads the
 * record key from the payload -- passing RecordID alone fails with
 * MANDATORY_NOT_FOUND on 'id'. RecordID is still sent because the REST-backed
 * dev adapter uses it to build the URL, so both transports are satisfied.
 */
async function updateOne(
  module: string,
  recordId: string,
  payload: Record<string, unknown>,
  what: string,
): Promise<void> {
  const res = await zoho().CRM.API.updateRecord({
    Entity: module,
    RecordID: recordId,
    APIData: { id: recordId, ...payload },
    Trigger: [],
  });
  assertWrote(res, what);
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
  /** Class code or name, used to compose the mandatory Name field. */
  classLabel: string;
  effectiveFrom?: string;
  effectiveTo?: string;
}

export async function createAllocation(a: NewAllocation): Promise<string> {
  const { module, fields } = ZOHO_MODULES.allocations;
  const payload: Record<string, unknown> = {
    // Name is system-mandatory on every custom module in this model, including
    // the join-like ones where there is no natural title. Omitting it fails
    // with MANDATORY_NOT_FOUND.
    [fields.name]: `${a.role} - ${a.classLabel}`,
    [fields.teacher]: { id: a.teacherId },
    [fields.class]: { id: a.classId },
    [fields.role]: a.role,
    [fields.status]: 'Active',
  };
  // Default the start date rather than leaving it blank: an allocation with
  // no Effective From cannot be ordered against the class's other staffing,
  // and the schema's date-order check has nothing to compare to.
  payload[fields.effective_from] = a.effectiveFrom ?? orgToday();
  if (a.effectiveTo) payload[fields.effective_to] = a.effectiveTo;

  const res = await zoho().CRM.API.insertRecord({ Entity: module, APIData: payload, Trigger: [] });
  return assertWrote(res, 'allocation');
}

export async function endAllocation(allocationId: string): Promise<void> {
  const { module, fields } = ZOHO_MODULES.allocations;
  await updateOne(
    module,
    allocationId,
    {
      [fields.status]: 'Ended',
      [fields.effective_to]: new Date().toISOString().slice(0, 10),
    },
    'allocation update',
  );
}

/**
 * Sets the class's headline teacher, kept alongside the allocation records.
 *
 * Pass null to clear it -- Zoho empties a lookup when the field is sent as
 * null. Needed when the last lead allocation ends: leaving the old name on the
 * class would show a teacher who is no longer assigned to it.
 */
export async function setPrimaryTeacher(
  classId: string,
  teacherId: string | null,
): Promise<void> {
  const { module, fields } = ZOHO_MODULES.classes;
  await updateOne(
    module,
    classId,
    { [fields.primary_teacher]: teacherId ? { id: teacherId } : null },
    'primary teacher update',
  );
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
  /** Used to compose the mandatory Name field. */
  studentName: string;
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
  sessionLabel: string,
): Promise<void> {
  const { module, fields } = ZOHO_MODULES.attendance;

  const payload: Record<string, unknown> = {
    // Name is system-mandatory on every custom module, including this one where
    // there is no natural title. Omitting it fails with MANDATORY_NOT_FOUND.
    [fields.name]: `${mark.studentName} - ${sessionLabel}`,
    [fields.class_session]: { id: sessionId },
    [fields.enrollment]: { id: mark.enrollmentId },
    [fields.student]: { id: mark.studentId },
    [fields.class]: { id: mark.classId },
    [fields.status]: mark.status,
    [fields.marked_at]: zohoDateTime(),
  };
  if (markedByTeacherId) payload[fields.marked_by] = { id: markedByTeacherId };

  if (mark.existingId) {
    await updateOne(module, mark.existingId, payload, 'attendance update');
    return;
  }
  const res = await zoho().CRM.API.insertRecord({ Entity: module, APIData: payload, Trigger: [] });
  assertWrote(res, 'attendance write');
}

/** Flags the session as done, so a half-finished sheet is distinguishable. */
export async function markSessionAttendanceTaken(
  sessionId: string,
  teacherId: string | null,
  markHeld = true,
): Promise<void> {
  const { module, fields } = ZOHO_MODULES.class_sessions;
  const payload: Record<string, unknown> = {
    [fields.attendance_taken]: true,
    [fields.attendance_taken_at]: zohoDateTime(),
  };
  // Never call a future lesson 'Held' -- that asserts it already happened.
  // Pre-recording an excusal must leave it Scheduled.
  if (markHeld) payload[fields.status] = 'Held';
  if (teacherId) payload[fields.teacher_taken] = { id: teacherId };

  await updateOne(module, sessionId, payload, 'session update');
}

// ---------------------------------------------------------------------------
// Timetable generation
// ---------------------------------------------------------------------------

/**
 * Expands a class's weekly pattern into the dated meetings it implies.
 *
 * Pure -- no I/O -- so the arithmetic is testable and the caller decides what
 * to write. Returns [] when the class has no meeting days or no date range,
 * rather than guessing a pattern.
 */
export function plannedSessions(klass: RawRecord): Array<{
  date: string;
  sequenceNo: number;
}> {
  const f = ZOHO_MODULES.classes.fields;
  const days = klass[f.meeting_days];
  const start = str(klass[f.start_date]);
  const end = str(klass[f.end_date]);
  if (!Array.isArray(days) || days.length === 0 || !start || !end) return [];

  const wanted = new Set<number>(
    days
      .map((d) => WEEKDAY_INDEX[String(d) as keyof typeof WEEKDAY_INDEX] as number | undefined)
      .filter((n): n is number => n !== undefined),
  );
  if (wanted.size === 0) return [];

  const out: Array<{ date: string; sequenceNo: number }> = [];
  const last = new Date(`${end}T00:00:00Z`);
  const cursor = new Date(`${start}T00:00:00Z`);
  // Guard against a malformed range producing an unbounded loop.
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime())) return [];

  while (cursor <= last) {
    if (wanted.has(cursor.getUTCDay())) {
      out.push({ date: cursor.toISOString().slice(0, 10), sequenceNo: out.length + 1 });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

const WEEKDAY_INDEX = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
} as const;

/** Sessions already recorded for a class, as a set of "date|start_time" keys. */
export async function getSessionKeysForClass(classId: string): Promise<Set<string>> {
  const { module, fields } = ZOHO_MODULES.class_sessions;
  const recs = await search(module, `(${fields.class}:equals:${classId})`);
  return new Set(recs.map((r) => `${str(r[fields.session_date])}|${str(r[fields.start_time])}`));
}

/** Zoho's per-call ceiling for a bulk create. */
export const BULK_LIMIT = 100;

export interface PlannedSession {
  klass: RawRecord;
  date: string;
  sequenceNo: number;
}

function sessionPayload(item: PlannedSession): Record<string, unknown> {
  const k = ZOHO_MODULES.classes.fields;
  const { fields } = ZOHO_MODULES.class_sessions;
  return {
    [fields.name]: `${str(item.klass[k.class_code], str(item.klass[k.name]))} - ${item.date}`,
    [fields.class]: { id: item.klass.id },
    [fields.session_date]: item.date,
    [fields.start_time]: str(item.klass[k.start_time]),
    [fields.end_time]: str(item.klass[k.end_time]),
    [fields.sequence_no]: item.sequenceNo,
    [fields.status]: 'Scheduled',
    [fields.attendance_taken]: false,
  };
}

/**
 * Creates one batch of sessions in a single call.
 *
 * `insertRecord` takes an array as well as a single record, so 100 rows cost
 * one request instead of 100. Caller must keep each batch within BULK_LIMIT.
 *
 * Unlike the single-record writes elsewhere in this file, the response has one
 * status row *per record*, so every row is checked -- a partial failure inside
 * a successful HTTP call would otherwise pass silently.
 */
export async function createClassSessionBatch(batch: PlannedSession[]): Promise<number> {
  if (batch.length === 0) return 0;
  if (batch.length > BULK_LIMIT) {
    throw new Error(`batch of ${batch.length} exceeds Zoho's limit of ${BULK_LIMIT}`);
  }
  const { module } = ZOHO_MODULES.class_sessions;
  const res = await zoho().CRM.API.insertRecord({
    Entity: module,
    APIData: batch.map(sessionPayload),
    Trigger: [],
  });

  const statuses = (res.data ?? []) as unknown as Array<{ code?: string; message?: string }>;
  const failed = statuses
    .map((row, i) => ({ row, item: batch[i]! }))
    .filter(({ row }) => row.code && row.code !== 'SUCCESS');

  if (failed.length > 0) {
    const first = failed[0]!;
    throw new Error(
      `${failed.length} of ${batch.length} lessons failed. First: ` +
        `${str(first.item.klass[ZOHO_MODULES.classes.fields.class_code])} ${first.item.date} — ` +
        `${first.row.code}: ${first.row.message ?? 'no message'}`,
    );
  }
  return statuses.length || batch.length;
}

/**
 * Fetches classes by id, as a map.
 *
 * A Class_Session links to its Class, and the Class links to the Term -- there
 * is no Term on the session itself. Showing the term in the timetable therefore
 * costs one hop, done here in parallel. The id set is small: it is the distinct
 * classes meeting on a single date, so typically one to six.
 */
export async function getClassesByIds(ids: string[]): Promise<Map<string, RawRecord>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const found = await Promise.all(
    unique.map(async (id) => {
      try {
        const res = await zoho().CRM.API.getRecord({
          Entity: ZOHO_MODULES.classes.module,
          RecordID: id,
        });
        return rows(res)[0] ?? null;
      } catch {
        // A class that cannot be read should blank that one cell, not break
        // the whole timetable.
        return null;
      }
    }),
  );
  const byId = new Map<string, RawRecord>();
  for (const rec of found) if (rec) byId.set(rec.id, rec);
  return byId;
}
