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

/**
 * Zoho's ceiling for one read. Asking for more is rejected, not truncated.
 */
const PAGE_SIZE = 200;

/**
 * How far `page`-based paging reaches: 10 x 200 = 2,000 records.
 *
 * Not an arbitrary safety valve -- it is Zoho's own boundary. Past 2,000 the
 * `page` parameter stops working and the read has to follow `next_page_token`
 * instead, which the embedded SDK's typed surface does not expose. So 2,000 is
 * the honest reach of this implementation.
 *
 * Every read in this file used to stop at the *first* page, silently. A term
 * with 1,000 admitted students returned 200 of them with nothing to say the
 * other 800 existed, and an empty-looking list is indistinguishable from a
 * wrong answer. Paging fixes that for every realistic size in this domain.
 *
 * Past the boundary it throws. Returning the first 2,000 rows and calling them
 * the answer would be the same lie in a larger font -- and a module that holds
 * more than 2,000 rows for one term is asking a question this screen is the
 * wrong shape for anyway.
 */
const MAX_PAGES = 10;

/**
 * Walks every page of a read.
 *
 * Sequential on purpose: `more_records` on page N is the only thing that says
 * whether page N+1 exists, so the pages cannot be fetched in parallel without
 * guessing how many there are.
 */
async function pageThrough(
  what: string,
  fetchPage: (page: number) => Promise<ZohoApiResponse>,
): Promise<RawRecord[]> {
  const all: RawRecord[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const res = await fetchPage(page);
    all.push(...rows(res));
    if (!res.info?.more_records) return all;
  }
  throw new Error(
    `${what}: more than ${MAX_PAGES * PAGE_SIZE} records, which is as far as page-based ` +
      `paging reaches. Reading beyond it needs next_page_token. Refusing to ` +
      `return a partial list as though it were complete.`,
  );
}

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

/**
 * A whole number out of a Zoho field, or null.
 *
 * Rollup fields (`Enrolled_Count`, `Sessions_Count`) come back as *strings* --
 * "4", not 4 -- and as `null` on a record whose rollup has never been computed.
 * Both have to be told apart from a real zero, so this returns null rather than
 * defaulting: "no figure yet" and "nobody enrolled" are different answers.
 */
export function int(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * The weekly pattern as stored: a multiselect picklist, so an array of names.
 *
 * Returns [] for a class that has never been given meeting days -- which is
 * exactly the class the timetable generator cannot produce lessons for.
 */
export function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Children of one parent record, read through the relationship.
 *
 * `searchRecord` is backed by a search index, and a record written through the
 * API does not appear in it for up to a minute or two. That matters far more
 * than it sounds: none of this model's composite-unique constraints are
 * natively enforced by Zoho (`build/zoho/validations.json` specifies a custom
 * function for each, and none is deployed), so the client-side dedupe read is
 * the *only* thing preventing duplicates. A dedupe read that cannot see rows
 * it just wrote will cheerfully write them again -- a second attendance mark
 * for the same student and lesson, or a second copy of a whole timetable.
 *
 * `getRelatedRecords` walks the actual relationship and is not index-backed,
 * so it has no such lag.
 *
 * The related-list api_name is not derivable from the schema, so the likely
 * candidates are tried in order. Returns null when none of them work, and
 * every caller falls back to `search` -- so in the worst case behaviour is
 * exactly what it was before, never worse.
 */
async function relatedRecords(
  parentModule: string,
  parentId: string,
  candidates: string[],
): Promise<RawRecord[] | null> {
  for (const RelatedList of candidates) {
    const read = (page: number) =>
      zoho().CRM.API.getRelatedRecords({
        Entity: parentModule,
        RecordID: parentId,
        RelatedList,
        per_page: PAGE_SIZE,
        page,
      });

    let first: ZohoApiResponse;
    try {
      first = await read(1);
    } catch {
      // Wrong related-list name for this org; try the next spelling.
      continue;
    }

    // Page 1 answered, so the name is right and this is the candidate. Any
    // failure from here is a real one and must not fall through to the next
    // spelling -- that would re-read page 1 under another name and return the
    // same children twice.
    // A parent with no children answers 204/empty rather than failing, which
    // is a valid empty result, not a reason to keep looking.
    const all = rows(first);
    if (!first.info?.more_records) return all;

    const rest = await pageThrough(`${parentModule}/${RelatedList}`, (page) => read(page + 1));
    return [...all, ...rest];
  }
  return null;
}

async function search(entity: string, query: string): Promise<RawRecord[]> {
  return pageThrough(`search ${entity}`, (page) =>
    zoho().CRM.API.searchRecord({
      Entity: entity,
      Type: 'criteria',
      Query: query,
      per_page: PAGE_SIZE,
      page,
    }),
  );
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
  // Read-after-write: the staffing screen re-reads this immediately after
  // adding or ending an allocation.
  return (
    (await relatedRecords(ZOHO_MODULES.classes.module, classId, [module, fields.class])) ??
    (await search(module, `(${fields.class}:equals:${classId})`))
  );
}

export interface NewAllocation {
  teacherId: string;
  classId: string;
  role: AllocationRole;
  /** Class code or name, used to compose the mandatory Name field. */
  classLabel: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  /**
   * One dated lesson instead of the whole class.
   *
   * The model is explicit about this: class_session NULL means the allocation
   * covers the whole term, and set means a single-session substitution on that
   * date. Leave it undefined for ordinary staffing.
   */
  classSessionId?: string;
  /** Session name or date, folded into Name so cover rows are tellable apart. */
  sessionLabel?: string;
  notes?: string;
}

export async function createAllocation(a: NewAllocation): Promise<string> {
  const { module, fields } = ZOHO_MODULES.allocations;
  const payload: Record<string, unknown> = {
    // Name is system-mandatory on every custom module in this model, including
    // the join-like ones where there is no natural title. Omitting it fails
    // with MANDATORY_NOT_FOUND.
    [fields.name]: a.sessionLabel
      ? `${a.role} - ${a.classLabel} - ${a.sessionLabel}`
      : `${a.role} - ${a.classLabel}`,
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
  // Only sent when present: writing the lookup as null on every ordinary
  // allocation would be a pointless field update on the common path.
  if (a.classSessionId) payload[fields.class_session] = { id: a.classSessionId };
  if (a.notes) payload[fields.notes] = a.notes;

  const res = await zoho().CRM.API.insertRecord({ Entity: module, APIData: payload, Trigger: [] });
  return assertWrote(res, 'allocation');
}

/**
 * Every dated lesson of one class, earliest first.
 *
 * Only needed by the one-lesson substitution path, so it is a separate call
 * rather than something the staffing screen fetches up front: a term's class
 * can carry thirty-odd sessions and the common allocation covers all of them.
 */
export async function getSessionsForClass(classId: string): Promise<RawRecord[]> {
  const { module, fields } = ZOHO_MODULES.class_sessions;
  const recs =
    (await relatedRecords(ZOHO_MODULES.classes.module, classId, [module, fields.class])) ??
    (await search(module, `(${fields.class}:equals:${classId})`));
  return recs.sort((a, b) =>
    `${str(a[fields.session_date])}${str(a[fields.start_time])}`.localeCompare(
      `${str(b[fields.session_date])}${str(b[fields.start_time])}`,
    ),
  );
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
export async function getEnrollmentsForClass(
  classId: string,
  /**
   * The register wants only the students it should be marking, so this
   * defaults to Active. The duplicate guard wants every row, because a
   * Dropped enrollment still occupies the (student, class) pair that
   * uq_enrollment_student_class is supposed to keep unique.
   */
  activeOnly = true,
): Promise<RawRecord[]> {
  const { module, fields } = ZOHO_MODULES.enrollments;
  const related = await relatedRecords(ZOHO_MODULES.classes.module, classId, [
    module,
    fields.class,
  ]);
  // The related list carries every enrollment, so the Active filter that the
  // search criteria applied server-side is applied here instead.
  if (related) return activeOnly ? related.filter((r) => str(r[fields.status]) === 'Active') : related;

  return activeOnly
    ? search(module, `((${fields.class}:equals:${classId})and(${fields.status}:equals:Active))`)
    : search(module, `(${fields.class}:equals:${classId})`);
}

/** Attendance already recorded for a session, keyed by enrollment id. */
export async function getAttendanceForSession(sessionId: string): Promise<Map<string, RawRecord>> {
  const { module, fields } = ZOHO_MODULES.attendance;
  // Read-after-write: saveMark upserts against this map, so a stale read
  // creates a duplicate mark instead of updating the existing one.
  const recs =
    (await relatedRecords(ZOHO_MODULES.class_sessions.module, sessionId, [
      module,
      fields.class_session,
    ])) ?? (await search(module, `(${fields.class_session}:equals:${sessionId})`));
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
  // Read-after-write: this set is the only guard against generating a second
  // copy of a timetable, so it must not miss rows written moments ago.
  const recs =
    (await relatedRecords(ZOHO_MODULES.classes.module, classId, [module, fields.class])) ??
    (await search(module, `(${fields.class}:equals:${classId})`));
  return new Set(recs.map((r) => `${str(r[fields.session_date])}|${str(r[fields.start_time])}`));
}

/**
 * Every closed date in the calendar, mapped to the reason it is closed.
 *
 * A holiday is stored as a range, because Eid runs several days. Timetable
 * generation asks "is this one date closed?", so the ranges are flattened once
 * into yyyy-MM-dd keys rather than compared per candidate lesson.
 *
 * A holiday with no Term applies to every term -- that is what makes it a
 * public holiday. A term-scoped closure only suppresses lessons in its own
 * term, so both are filtered here rather than at the call site.
 */
export async function getClosedDates(termId: string): Promise<Map<string, string>> {
  const { module, fields } = ZOHO_MODULES.holidays;
  // Every holiday, not a filtered subset. A search needs criteria and there is
  // no criterion meaning "all"; the table is small -- a year of closures is a
  // couple of dozen rows.
  const recs = await pageThrough(`all ${module}`, (page) =>
    zoho().CRM.API.getAllRecords({ Entity: module, per_page: PAGE_SIZE, page }),
  );

  const closed = new Map<string, string>();
  for (const rec of recs) {
    const scope = refId(rec[fields.term]);
    if (scope && scope !== termId) continue;

    const start = str(rec[fields.start_date]);
    if (!start) continue;
    const last = str(rec[fields.end_date], start);

    const cursor = new Date(`${start}T00:00:00Z`);
    const end = new Date(`${last}T00:00:00Z`);
    if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) continue;

    // A closure longer than a year is a data error, not something to expand --
    // and an unbounded loop here would hang the page.
    let guard = 0;
    while (cursor <= end && guard < 400) {
      closed.set(cursor.toISOString().slice(0, 10), str(rec[fields.name], 'Closed'));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      guard += 1;
    }
  }
  return closed;
}

// ---------------------------------------------------------------------------
// Enrollment board -- placing admitted students into this term's classes
// ---------------------------------------------------------------------------

/**
 * Applications for one term that have a student record behind them.
 *
 * An application only back-fills `student` once it is accepted, so anything
 * still earlier in the pipeline has nobody to place. Rejected and Withdrawn
 * are dropped for the obvious reason. Everything else -- Offered, Accepted,
 * Enrolled -- is someone the office may still be assigning to classes, since
 * "Enrolled" means admitted to the school, not placed in a section.
 */
export async function getAdmissionsForTerm(termId: string): Promise<RawRecord[]> {
  const { module, fields } = ZOHO_MODULES.admissions;
  const recs = await search(module, `(${fields.term}:equals:${termId})`);
  const out = recs.filter((r) => {
    const stage = str(r[fields.stage]);
    return stage !== 'Rejected' && stage !== 'Withdrawn' && Boolean(refId(r[fields.student]));
  });
  return out.sort((a, b) =>
    refName(a[fields.student]).localeCompare(refName(b[fields.student])),
  );
}

/**
 * Every active student, for the terms that predate the admissions pipeline.
 *
 * Not every student in this org arrived through an application -- older terms
 * were seeded directly -- so a board that only ever offered admitted
 * applicants would be empty on exactly those terms.
 */
export async function getActiveStudents(): Promise<RawRecord[]> {
  const { module, fields } = ZOHO_MODULES.students;
  const recs = await search(module, `(${fields.status}:equals:Active)`);
  return recs.sort((a, b) => str(a[fields.full_name]).localeCompare(str(b[fields.full_name])));
}

/**
 * Every enrollment across a set of classes.
 *
 * One query per class, through the relationship -- deliberately, and at the
 * cost of N calls instead of the single term-wide search that
 * `enrollments.term` was denormalized to make possible.
 *
 * That search is backed by an index which does not yet contain a row written
 * moments ago. The enrollment board both writes rows and derives its seat
 * counts from this read, so a lagging index there shows a drop that visibly
 * did nothing -- while the duplicate guard, which does read through the
 * relationship, refuses the retry. The N calls buy consistency between the
 * two, and the staffing view already fans out this way for its staff counts.
 */
export async function getEnrollmentsForClasses(classIds: string[]): Promise<RawRecord[]> {
  const lists = await Promise.all(classIds.map((id) => getEnrollmentsForClass(id, false)));
  return lists.flat();
}

export interface NewEnrollment {
  studentId: string;
  classId: string;
  /** Student name and class code, used to compose the mandatory Name field. */
  studentLabel: string;
  classLabel: string;
  /** Copied off the class so the two-hop queries work -- see below. */
  courseId?: string;
  termId?: string;
}

/**
 * Puts one student in one class.
 *
 * Two things here are not obvious.
 *
 * `course` and `term` are written explicitly even though the schema marks them
 * `derived_from: class.course` / `class.term` and says a Zoho workflow keeps
 * them in step. That workflow is not something this client can verify exists,
 * and every COQL question worth asking -- "who is in this term", "who is on
 * this course" -- reads those two fields. Writing them costs nothing and a
 * missing workflow would otherwise produce rows that no query can find.
 *
 * Status is `Active`, not the schema default of `Pending`. Enrolling from the
 * board is a deliberate placement, and the register reads Active only
 * (getEnrollmentsForClass) -- a Pending row would leave the student invisible
 * to the teacher who has to mark them present.
 */
function enrollmentPayload(e: NewEnrollment): Record<string, unknown> {
  const { fields } = ZOHO_MODULES.enrollments;
  const payload: Record<string, unknown> = {
    // Mandatory on every custom module in this model, join-like ones included.
    [fields.name]: `${e.studentLabel} - ${e.classLabel}`,
    [fields.student]: { id: e.studentId },
    [fields.class]: { id: e.classId },
    [fields.status]: 'Active',
    [fields.enrolled_on]: orgToday(),
  };
  if (e.courseId) payload[fields.course] = { id: e.courseId };
  if (e.termId) payload[fields.term] = { id: e.termId };
  return payload;
}

export async function createEnrollment(e: NewEnrollment): Promise<string> {
  const { module } = ZOHO_MODULES.enrollments;
  const res = await zoho().CRM.API.insertRecord({
    Entity: module,
    APIData: enrollmentPayload(e),
    Trigger: [],
  });
  return assertWrote(res, 'enrollment');
}

/** One student's outcome in a bulk enrolment. */
export interface EnrollmentFailure {
  studentLabel: string;
  reason: string;
}

/**
 * Enrols many students in one class, in a single request.
 *
 * `insertRecord` takes an array as well as a single record, so 40 placements
 * cost one round trip rather than 40. The response carries **one status row
 * per record**, so every row is checked -- reading only `data[0]` would report
 * a wholly failed batch as a success whenever its first row happened to land.
 *
 * Partial success is the normal outcome and is reported rather than thrown:
 * one rejected row should not discard the thirty-nine that went in.
 */
export async function createEnrollmentBatch(
  rows: NewEnrollment[],
): Promise<{ ok: { row: NewEnrollment; id: string }[]; failed: EnrollmentFailure[] }> {
  if (rows.length === 0) return { ok: [], failed: [] };
  if (rows.length > BULK_LIMIT) {
    throw new Error(`batch of ${rows.length} exceeds Zoho's limit of ${BULK_LIMIT}`);
  }

  const { module } = ZOHO_MODULES.enrollments;
  const res = await zoho().CRM.API.insertRecord({
    Entity: module,
    APIData: rows.map(enrollmentPayload),
    Trigger: [],
  });

  const statuses = (res.data ?? []) as Array<{
    code?: string;
    message?: string;
    details?: { id?: string };
  }>;

  const ok: { row: NewEnrollment; id: string }[] = [];
  const failed: EnrollmentFailure[] = [];
  rows.forEach((row, i) => {
    const status = statuses[i];
    // The id comes back per row, and the caller needs it: a placement it
    // cannot address is one it cannot undo until the next full read.
    if (status?.code === 'SUCCESS' && status.details?.id) {
      ok.push({ row, id: status.details.id });
    } else {
      failed.push({
        studentLabel: row.studentLabel,
        reason: status?.code ? `${status.code}: ${status.message ?? 'rejected'}` : 'no response row',
      });
    }
  });
  return { ok, failed };
}

/**
 * Is this student already in this class?
 *
 * `uq_enrollment_student_class` is in build/zoho/validations.json as a custom
 * function and is *not deployed* -- Zoho has no composite unique field -- so
 * nothing server-side stops a duplicate. This read is the only guard, and it
 * goes through the relationship rather than search for the reason spelled out
 * on relatedRecords: a row written seconds ago is not in the search index yet,
 * and a dedupe check that cannot see it will cheerfully write it twice.
 */
export async function isAlreadyEnrolled(classId: string, studentId: string): Promise<boolean> {
  const { fields } = ZOHO_MODULES.enrollments;
  const existing = await getEnrollmentsForClass(classId, false);
  return existing.some((r) => refId(r[fields.student]) === studentId);
}

/**
 * The whole active course catalogue.
 *
 * One request, not one per class. A class names its course but not its
 * programme -- the programme hangs off the course, and COQL cannot join two
 * hops, which is the same wall `enrollments.course`/`term` were denormalized
 * to get around. Rather than read each course by id, this reads the catalogue
 * whole: it is a small, slow-moving table, and a term's classes point at a
 * handful of its rows.
 */
export async function getCourses(): Promise<RawRecord[]> {
  const { module, fields } = ZOHO_MODULES.courses;
  return search(module, `(${fields.status}:equals:Active)`);
}

/**
 * Removes an enrolment outright.
 *
 * Deleted, not marked `Dropped`. A Dropped row still occupies the
 * (student, class) pair that `isAlreadyEnrolled` guards, so the student could
 * never be put back into the class they had just been wrongly taken out of.
 * `Dropped` is for a student who genuinely left partway through; this is for a
 * placement that should never have existed.
 */
export async function deleteEnrollment(enrollmentId: string): Promise<void> {
  const { module } = ZOHO_MODULES.enrollments;
  const res = await zoho().CRM.API.deleteRecord({ Entity: module, RecordID: enrollmentId });
  assertWrote(res, 'enrollment delete');
}

/**
 * Attendance marks per enrolment, for one class.
 *
 * `attendance.class` is denormalized off the enrolment precisely so this is one
 * query instead of one per student -- the same two-hop limit that shaped
 * `enrollments.course`/`term`.
 *
 * Read through the relationship rather than the search index: this backs a
 * guard against deleting a register, and a guard that cannot see marks written
 * a minute ago would wave through exactly the deletion it exists to stop.
 */
export async function getAttendanceCountsForClass(classId: string): Promise<Map<string, number>> {
  const { module, fields } = ZOHO_MODULES.attendance;
  const recs =
    (await relatedRecords(ZOHO_MODULES.classes.module, classId, [module, fields.class])) ??
    (await search(module, `(${fields.class}:equals:${classId})`));

  const counts = new Map<string, number>();
  for (const rec of recs) {
    const id = refId(rec[fields.enrollment]);
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
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
