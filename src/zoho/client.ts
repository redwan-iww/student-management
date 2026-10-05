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

/**
 * Terms worth showing in the picker: running, open for enrollment, or finished.
 *
 * Closed is included deliberately. A term that has ended still has a roster, a
 * register and results behind it, and the staffing and enrolment views are the
 * only way to look at them -- excluding it made last term unreachable the day
 * it ended. Archived is the status for a term that should drop out of the
 * picker, and that one is still excluded.
 */
export async function getActiveTerms(): Promise<RawRecord[]> {
  const { module, fields } = ZOHO_MODULES.terms;
  const recs = await search(
    module,
    `((${fields.status}:equals:Open)or(${fields.status}:equals:In Progress)or(${fields.status}:equals:Closed))`,
  );
  return recs.sort((a, b) => str(a[fields.start_date]).localeCompare(str(b[fields.start_date])));
}

/**
 * The term to open on: the one running today.
 *
 * Was simply the first in the list, which getActiveTerms sorts by start date
 * -- right only by coincidence, and wrong the moment a past term sorts ahead
 * of the live one. Falls back to the next term due to start, then to the last,
 * so there is always a selection even between terms or after the last ended.
 *
 * Compared in the school's timezone, not the browser's -- see ORG_TIME_ZONE.
 *
 * Lives here rather than on the screen that first needed it, next to the call
 * whose result it picks from: two screens were choosing a default term and
 * only one of them was choosing it correctly.
 */
export function currentTerm(terms: RawRecord[]): string {
  const { fields } = ZOHO_MODULES.terms;
  const today = orgToday();
  const running = terms.find(
    (t) => str(t[fields.start_date]) <= today && today <= str(t[fields.end_date]),
  );
  if (running) return running.id;

  // terms arrive sorted by start date, so the first still ahead of today is
  // the next one due
  const next = terms.find((t) => str(t[fields.start_date]) > today);
  if (next) return next.id;

  return terms[terms.length - 1]?.id ?? '';
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
/**
 * Every session between two dates, inclusive.
 *
 * Two paths, because search cannot express a range here. `equals` on the date
 * is the only date criterion this org's search endpoint accepts: a range
 * written as
 * `((Session_Date:greater_equal:a)and(Session_Date:less_equal:b))` is rejected
 * outright with "INVALID_QUERY: Invalid query formed: (field: Session_Date)",
 * the same way `not_equal:null` on a lookup is.
 *
 * So one day searches, and anything wider reads the module and filters here.
 * That sounds worse than it is: the whole table is under 400 rows, which is
 * two pages, while a week filtered server-side would have been seven searches
 * and a term around ninety. The read-everything path is the cheaper one for
 * every span except the single day, which is exactly the one that keeps its
 * search.
 *
 * Sorted by date then time, because every caller renders a timetable and a
 * timetable is read in that order.
 */
export async function getSessionsBetween(
  fromIso: string,
  toIso: string,
): Promise<RawRecord[]> {
  const { module, fields } = ZOHO_MODULES.class_sessions;

  const recs =
    fromIso === toIso
      ? await search(module, `(${fields.session_date}:equals:${fromIso})`)
      : (
          await pageThrough(`all ${module}`, (page) =>
            zoho().CRM.API.getAllRecords({ Entity: module, per_page: PAGE_SIZE, page }),
          )
        ).filter((r) => {
          // yyyy-MM-dd is fixed width, so string order is date order.
          const d = str(r[fields.session_date]);
          return d >= fromIso && d <= toIso;
        });

  return recs.sort(
    (a, b) =>
      str(a[fields.session_date]).localeCompare(str(b[fields.session_date])) ||
      str(a[fields.start_time]).localeCompare(str(b[fields.start_time])),
  );
}

/**
 * The classes that have actually met: a lesson in the past with its register
 * taken.
 *
 * This is the one fact in the system that proves a class is running rather
 * than planned. You cannot take a register without students, a teacher and a
 * room, so a taken register answers the whole go/no-go at once -- and unlike
 * the Status field on the class, nobody has to remember to set it.
 *
 * Read in full and filtered here, like the week and month views: Session_Date
 * cannot be searched as a range -- `greater_equal` is rejected with
 * INVALID_QUERY -- and a boolean criterion on Attendance_Taken is not worth
 * betting the screen on when the same read already serves.
 */
export async function getClassesThatHaveMet(): Promise<Set<string>> {
  const { module, fields } = ZOHO_MODULES.class_sessions;
  const today = orgToday();
  const recs = await pageThrough(`all ${module}`, (page) =>
    zoho().CRM.API.getAllRecords({ Entity: module, per_page: PAGE_SIZE, page }),
  );

  const met = new Set<string>();
  for (const r of recs) {
    // A register taken against a future date is somebody marking ahead, not a
    // lesson that happened. yyyy-MM-dd is fixed width, so string order is date
    // order.
    if (str(r[fields.session_date]) > today) continue;
    if (r[fields.attendance_taken] !== true) continue;
    const id = refId(r[fields.class]);
    if (id) met.add(id);
  }
  return met;
}

export async function getClassSession(sessionId: string): Promise<RawRecord | null> {
  const { module } = ZOHO_MODULES.class_sessions;
  const res = await zoho().CRM.API.getRecord({ Entity: module, RecordID: sessionId });
  return rows(res)[0] ?? null;
}

/**
 * The people in a class -- the roster the attendance sheet renders.
 *
 * "In" means Active or Completed. A term that has finished leaves Completed
 * enrolments behind, and its registers are still worth opening: excluding
 * them showed "No students enrolled" over a class that ran all term and has a
 * register for every session of it.
 */
export const PLACED_STAGES = ['Placed', 'Completed'] as const;

/**
 * The admissions sitting in one class -- its roster.
 *
 * An admission names a course; the class is filled in when the student is put
 * into a run of it. So "who is in this class" is "which admissions point at
 * it", and a student who was admitted to the subject but never placed simply
 * has no class to be found by.
 */
export async function getAdmissionsForClass(
  classId: string,
  /**
   * The register wants the students it should be marking -- or, on a finished
   * class, reviewing -- so this defaults to true. The duplicate guard wants
   * every row, because a Dropped admission still holds the place its student
   * had, and re-placing them must not make a second one.
   */
  placedOnly = true,
): Promise<RawRecord[]> {
  const { module, fields } = ZOHO_MODULES.admissions;
  const related = await relatedRecords(ZOHO_MODULES.classes.module, classId, [
    module,
    fields.class,
  ]);
  const placed = (r: RawRecord) =>
    (PLACED_STAGES as readonly string[]).includes(str(r[fields.stage]));

  // The related list carries every admission, so the stage filter that the
  // search criteria applied server-side is applied here instead.
  if (related) return placedOnly ? related.filter(placed) : related;

  return placedOnly
    ? search(
        module,
        `((${fields.class}:equals:${classId})and((${fields.stage}:equals:Placed)or(${fields.stage}:equals:Completed)))`,
      )
    : search(module, `(${fields.class}:equals:${classId})`);
}

/** Attendance already recorded for a session, keyed by admission id. */
export async function getAttendanceForSession(sessionId: string): Promise<Map<string, RawRecord>> {
  const { module, fields } = ZOHO_MODULES.attendance;
  // Read-after-write: saveMark upserts against this map, so a stale read
  // creates a duplicate mark instead of updating the existing one.
  const recs =
    (await relatedRecords(ZOHO_MODULES.class_sessions.module, sessionId, [
      module,
      fields.class_session,
    ])) ?? (await search(module, `(${fields.class_session}:equals:${sessionId})`));
  const byAdmission = new Map<string, RawRecord>();
  for (const rec of recs) {
    const admissionId = refId(rec[fields.admission]);
    if (admissionId) byAdmission.set(admissionId, rec);
  }
  return byAdmission;
}

export interface AttendanceMark {
  admissionId: string;
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
 * (admission, class_session) is not a native Zoho unique constraint -- see
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
    [fields.admission]: { id: mark.admissionId },
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
 * Every admission in one term -- one row per student per subject.
 *
 * This is what the enrolment board's left panel lists: a student admitted to
 * five courses is five cards, each waiting for a class of its own course. The
 * grain is the point. The old version was one row per applicant, which could
 * say who to place but never what to place them in.
 *
 * Withdrawn and Dropped are left out: the first never took the subject, the
 * second has stopped. Both would otherwise sit on the board forever as work
 * that cannot be done.
 */
export async function getAdmissionsForTerm(termId: string): Promise<RawRecord[]> {
  const { module, fields } = ZOHO_MODULES.admissions;
  const recs = await search(module, `(${fields.term}:equals:${termId})`);
  const out = recs.filter((r) => {
    const stage = str(r[fields.stage]);
    return stage !== 'Withdrawn' && stage !== 'Dropped' && Boolean(refId(r[fields.student]));
  });
  return out.sort(
    (a, b) =>
      refName(a[fields.student]).localeCompare(refName(b[fields.student])) ||
      refName(a[fields.course]).localeCompare(refName(b[fields.course])),
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
 * Every placement across a set of classes.
 *
 * One query per class, through the relationship -- deliberately, and at the
 * cost of N calls instead of a single term-wide search.
 *
 * That search is backed by an index which does not yet contain a row written
 * moments ago. The board both writes placements and derives its seat counts
 * from this read, so a lagging index there shows a placement that visibly did
 * nothing -- while the duplicate guard, which does read through the
 * relationship, refuses the retry. The N calls buy consistency between the
 * two, and the staffing view already fans out this way for its staff counts.
 */
export async function getAdmissionsForClasses(classIds: string[]): Promise<RawRecord[]> {
  const lists = await Promise.all(classIds.map((id) => getAdmissionsForClass(id, false)));
  return lists.flat();
}

/** One admission being put into a class. */
export interface Placement {
  admissionId: string;
  classId: string;
  /** Student name and class code, for the message when it fails. */
  studentLabel: string;
  classLabel: string;
}

/**
 * Puts one admission into a class.
 *
 * An update, not an insert. The row already exists -- it was created when the
 * fee was settled, naming the subject the student is admitted to -- and
 * placing them only answers *which run of it*. Creating a second record here
 * would mean the permission to take a subject and the seat taken for it could
 * disagree, which is the shape the old enrollments module had.
 *
 * Stage goes to Placed, which is what the register reads
 * (getAdmissionsForClass) -- leaving it at Admitted would hide the student
 * from the teacher who has to mark them present.
 */
export async function placeAdmission(place: Placement): Promise<void> {
  const { module, fields } = ZOHO_MODULES.admissions;
  await updateOne(
    module,
    place.admissionId,
    {
      [fields.class]: { id: place.classId },
      [fields.stage]: 'Placed',
      [fields.placed_on]: orgToday(),
    },
    'placement',
  );
}

/** One student's outcome in a bulk placement. */
export interface PlacementFailure {
  studentLabel: string;
  reason: string;
}

/**
 * Places many admissions, one request each, issued together.
 *
 * Not one request for the batch: `updateRecord` addresses a single RecordID,
 * and the bulk form `insertRecord` offers has no update counterpart in the
 * widget SDK. Forty placements are therefore forty requests rather than one --
 * the cost of the admission row being the thing updated instead of a new row
 * being written.
 *
 * Partial success is the normal outcome and is reported rather than thrown:
 * one rejected row should not discard the thirty-nine that went in.
 */
export async function placeAdmissionBatch(
  rows: Placement[],
): Promise<{ ok: Placement[]; failed: PlacementFailure[] }> {
  if (rows.length === 0) return { ok: [], failed: [] };

  const results = await Promise.all(
    rows.map((row) =>
      placeAdmission(row).then(
        () => ({ row, error: null as string | null }),
        (err: unknown) => ({ row, error: describeError(err) }),
      ),
    ),
  );

  const ok: Placement[] = [];
  const failed: PlacementFailure[] = [];
  for (const { row, error } of results) {
    if (error === null) ok.push(row);
    else failed.push({ studentLabel: row.studentLabel, reason: error });
  }
  return { ok, failed };
}

/**
 * Takes an admission back out of its class, without un-admitting it.
 *
 * The distinction the old module could not make: deleting a placement used to
 * delete the only record that the student was entitled to the subject at all.
 * Here the row stays, the class is cleared, and the student goes back to the
 * board's left panel waiting to be placed somewhere else.
 */
export async function unplaceAdmission(admissionId: string): Promise<void> {
  const { module, fields } = ZOHO_MODULES.admissions;
  await updateOne(
    module,
    admissionId,
    { [fields.class]: null, [fields.stage]: 'Admitted', [fields.placed_on]: null },
    'unplace',
  );
}

/** Ends an admission: the student has left the subject, not just the class. */
export async function dropAdmission(admissionId: string, reason: string): Promise<void> {
  const { module, fields } = ZOHO_MODULES.admissions;
  await updateOne(
    module,
    admissionId,
    {
      [fields.stage]: 'Dropped',
      [fields.dropped_on]: orgToday(),
      [fields.drop_reason]: reason,
    },
    'drop',
  );
}

/**
 * Is this student already in this class?
 *
 * `uq_admission_student_course_term` is in build/zoho/validations.json as a
 * custom function and is *not deployed* -- Zoho has no composite unique field
 * -- so nothing server-side stops a duplicate. This read is the only guard,
 * and it goes through the relationship rather than search for the reason
 * spelled out on relatedRecords: a row written seconds ago is not in the
 * search index yet, and a dedupe check that cannot see it will cheerfully
 * write it twice.
 */
export async function isAlreadyPlaced(classId: string, studentId: string): Promise<boolean> {
  const { fields } = ZOHO_MODULES.admissions;
  const existing = await getAdmissionsForClass(classId, false);
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
 * Which programmes offer which course.
 *
 * The whole junction in one read, not a query per course: it is a few dozen
 * rows for a catalogue of this size, and every caller wants the mapping as a
 * whole rather than one course's programmes.
 *
 * A course belongs to as many programmes as offer it -- Mathematics 101 is one
 * course taught in several streams, not a copy per stream.
 */

/**
 * Removes an enrolment outright.
 *
 * Deleted, not marked `Dropped`. A Dropped row still occupies the
 * (student, class) pair that `isAlreadyEnrolled` guards, so the student could
 * never be put back into the class they had just been wrongly taken out of.
 * `Dropped` is for a student who genuinely left partway through; this is for a
 * placement that should never have existed.
 */
/**
 * A wall-clock time in the org's timezone, as Zoho wants it written.
 *
 * `zohoDateTime` stamps the *browser's* offset, which is right for "now" and
 * wrong for a time somebody typed: a datetime-local input yields bare
 * wall-clock text, and an admin in another timezone would otherwise save an
 * interview an hour or six out. The offset is looked up for the org instead.
 *
 * Asia/Dhaka has no daylight saving, so the offset does not depend on the
 * instant; a zone that did would need care exactly at a transition.
 */
export function orgDateTime(local: string): string {
  if (!/^d{4}-d{2}-d{2}Td{2}:d{2}$/.test(local)) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ORG_TIME_ZONE,
    timeZoneName: 'longOffset',
  }).formatToParts(new Date(`${local}:00Z`));
  // 'GMT+06:00', or plain 'GMT' on a zero-offset zone.
  const raw = parts.find((x) => x.type === 'timeZoneName')?.value ?? '';
  const offset = raw.replace('GMT', '') || '+00:00';
  return `${local}:00${offset}`;
}

/** Zoho's datetime back into what a datetime-local input accepts. */
export function localDateTime(value: unknown): string {
  const text = str(value);
  return /^d{4}-d{2}-d{2}Td{2}:d{2}/.test(text) ? text.slice(0, 16) : '';
}

/**
 * Saves edits to one student.
 *
 * The payload is keyed by API name and built by the caller, which already
 * holds the field map -- so this stays a thin, typed way through updateOne
 * rather than a second place that has to know what a student is made of.
 * Autonumbers and rollups are never included: the server owns them.
 */
export async function updateStudent(
  studentId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await updateOne(ZOHO_MODULES.students.module, studentId, payload, 'student update');
}

/** Saves edits to one application. Same contract as updateStudent. */
export async function updateAdmission(
  admissionId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await updateOne(ZOHO_MODULES.admissions.module, admissionId, payload, 'admission update');
}

/**
 * The family behind a student.
 *
 * `households` is the stock Contacts module wearing custom fields, so the
 * api_names are a mix: Last_Name carries the family name and the address is
 * Zoho's own Mailing_* set, while the guardians and billing are custom. The
 * generated field map is the only place that knows which is which.
 *
 * Fetched rather than joined: a student's lookup carries the household's id
 * and name and nothing else, and COQL cannot reach through it to the contact
 * details -- the same two-hop limit that shaped enrollments.course/term.
 */
export async function getHousehold(householdId: string): Promise<RawRecord | null> {
  const { module } = ZOHO_MODULES.households;
  const res = await zoho().CRM.API.getRecord({ Entity: module, RecordID: householdId });
  return rows(res)[0] ?? null;
}

/** Saves edits to one household. Same contract as updateStudent. */
export async function updateHousehold(
  householdId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await updateOne(ZOHO_MODULES.households.module, householdId, payload, 'household update');
}

/**
 * Every subject one student has been admitted to, across every term.
 *
 * Not scoped to the selected term on purpose: the question this answers is
 * "what has this child taken", and the answer runs backwards through terms
 * that are over. The course and the class are both on the row, so one read
 * carries the subject, the run of it, and the term together.
 *
 * Read through the relationship first, which sees a placement made moments
 * ago; the search index does not.
 */
export async function getAdmissionsForStudent(studentId: string): Promise<RawRecord[]> {
  const { module, fields } = ZOHO_MODULES.admissions;
  const recs =
    (await relatedRecords(ZOHO_MODULES.students.module, studentId, [module, fields.student])) ??
    (await search(module, `(${fields.student}:equals:${studentId})`));

  // Newest first: the term they are in now matters more than the one they
  // finished a year ago.
  return recs.sort((a, b) =>
    str(b[fields.applied_date]).localeCompare(str(a[fields.applied_date])),
  );
}

/**
 * Every attendance mark for one student, across every class and term.
 *
 * `attendance.student` is denormalized off the enrolment for exactly this:
 * one read answers "how often has this child turned up", where going via the
 * classes would be one request per class. The caller groups by enrolment.
 *
 * Through the relationship, so a mark saved moments ago is included.
 */
export async function getAttendanceForStudent(studentId: string): Promise<RawRecord[]> {
  const { module, fields } = ZOHO_MODULES.attendance;
  return (
    (await relatedRecords(ZOHO_MODULES.students.module, studentId, [module, fields.student])) ??
    (await search(module, `(${fields.student}:equals:${studentId})`))
  );
}

/** One student record in full -- the list reads carry only a lookup's id and name. */
export async function getStudent(studentId: string): Promise<RawRecord | null> {
  const { module } = ZOHO_MODULES.students;
  const res = await zoho().CRM.API.getRecord({ Entity: module, RecordID: studentId });
  return rows(res)[0] ?? null;
}

/**
 * Attendance marks per admission, for one class.
 *
 * `attendance.class` is denormalized off the admission precisely so this is one
 * query instead of one per student -- the same two-hop limit that shaped
 * `enrollments.course`/`term`.
 *
 * Read through the relationship rather than the search index: this backs a
 * guard against deleting a register, and a guard that cannot see marks written
 * a minute ago would wave through exactly the deletion it exists to stop.
 */
export interface AttendanceStats {
  /** Every mark, whatever its status. Backs the delete guard. */
  marks: number;
  /** Present or Late -- the numerator of the rate. */
  present: number;
  /** Marks that count towards a rate at all; Excused is neither hit nor miss. */
  eligible: number;
}

export async function getAttendanceStatsForClass(
  classId: string,
): Promise<Map<string, AttendanceStats>> {
  const { module, fields } = ZOHO_MODULES.attendance;
  const recs =
    (await relatedRecords(ZOHO_MODULES.classes.module, classId, [module, fields.class])) ??
    (await search(module, `(${fields.class}:equals:${classId})`));

  const stats = new Map<string, AttendanceStats>();
  for (const rec of recs) {
    const id = refId(rec[fields.admission]);
    if (!id) continue;
    const row = stats.get(id) ?? { marks: 0, present: 0, eligible: 0 };
    const status = str(rec[fields.status]);
    row.marks += 1;
    if (status !== 'Excused') row.eligible += 1;
    if (status === 'Present' || status === 'Late') row.present += 1;
    stats.set(id, row);
  }
  return stats;
}

/**
 * Attendance rate as a whole percent, or null when nothing counts yet.
 *
 * `admissions.attendance_rate` is a rollup in the schema, but the field was
 * never created in the CRM -- selecting Attendance_Rate fails with an invalid
 * column. So it is computed here from the marks already being read for the
 * delete guard, to the rollup's own definition: Present or Late over
 * everything that is not Excused.
 */
export function attendanceRate(s: AttendanceStats | undefined): number | null {
  if (!s || s.eligible === 0) return null;
  return Math.round((s.present / s.eligible) * 100);
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
