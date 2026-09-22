// A fake ZOHO global for local development.
//
// Mocking at the SDK boundary rather than inside client.ts means the real code
// path -- client.ts, both tab apps, the generated ZOHO_MODULES map -- runs
// completely unchanged. Only the transport is fake.
//
// Dev-only: each entry installs this behind `import.meta.env.DEV`, so it is
// tree-shaken out of production builds.

import { ZOHO_MODULES } from '../generated/types';

const S = ZOHO_MODULES.class_sessions.fields;
const E = ZOHO_MODULES.enrollments.fields;
const A = ZOHO_MODULES.attendance.fields;
const C = ZOHO_MODULES.classes.fields;
const T = ZOHO_MODULES.terms.fields;
const TE = ZOHO_MODULES.teachers.fields;
const AL = ZOHO_MODULES.allocations.fields;

type Rec = Record<string, unknown> & { id: string };

const TERM_ID = '1000000000001';
const today = new Date().toISOString().slice(0, 10);

const terms: Rec[] = [
  { id: TERM_ID, [T.name]: '2026 Term 1', [T.status]: 'In Progress',
    [T.start_date]: '2026-01-19', [T.end_date]: '2026-04-03' },
  { id: '1000000000002', [T.name]: '2026 Term 2', [T.status]: 'Open',
    [T.start_date]: '2026-04-20', [T.end_date]: '2026-07-03' },
];

const teachers: Rec[] = [
  ['Nadia Karim', 'TCH-0001'], ['Omar Siddique', 'TCH-0002'],
  ['Priya Das', 'TCH-0003'], ['Rafiq Ahmed', 'TCH-0004'],
].map(([name, code], i) => ({
  id: `2${String(i).padStart(12, '0')}`,
  [TE.full_name]: name, [TE.staff_code]: code, [TE.status]: 'Active',
}));

const classes: Rec[] = [
  ['MATH101-2026T1-A', 25, 0],
  ['MATH101-2026T1-B', 25, -1],
  ['ENG204-2026T1-A', 18, 2],
].map(([name, cap, teacherIdx], i) => {
  const t = (teacherIdx as number) >= 0 ? teachers[teacherIdx as number]! : null;
  return {
    id: `3${String(i).padStart(12, '0')}`,
    [C.name]: name, [C.class_code]: name, [C.capacity]: cap,
    [C.term]: { id: TERM_ID, name: '2026 Term 1' },
    [C.primary_teacher]: t ? { id: t.id, name: t[TE.full_name] } : null,
  };
});

const allocations: Rec[] = [
  { id: '9000000000001',
    [AL.teacher]: { id: teachers[0]!.id, name: teachers[0]![TE.full_name] },
    [AL.class]: { id: classes[0]!.id, name: classes[0]![C.name] },
    [AL.role]: 'Lead Teacher', [AL.status]: 'Active', [AL.effective_from]: '2026-01-19' },
  { id: '9000000000002',
    [AL.teacher]: { id: teachers[3]!.id, name: teachers[3]![TE.full_name] },
    [AL.class]: { id: classes[0]!.id, name: classes[0]![C.name] },
    [AL.role]: 'Assistant', [AL.status]: 'Active', [AL.effective_from]: '2026-01-19' },
];

const sessions: Rec[] = [
  { id: '4000000000001', [S.name]: `MATH101-2026T1-A - ${today}`,
    [S.session_date]: today, [S.start_time]: '09:00', [S.end_time]: '10:00',
    [S.class]: { id: classes[0]!.id, name: classes[0]![C.name] },
    [S.status]: 'Scheduled', [S.attendance_taken]: false },
  { id: '4000000000002', [S.name]: `ENG204-2026T1-A - ${today}`,
    [S.session_date]: today, [S.start_time]: '11:00', [S.end_time]: '12:30',
    [S.class]: { id: classes[2]!.id, name: classes[2]![C.name] },
    [S.status]: 'Held', [S.attendance_taken]: true },
];

const STUDENT_NAMES = [
  'Ayesha Rahman', 'Bilal Hossain', 'Chloe Nguyen', 'Dipto Barua',
  'Esha Chowdhury', 'Farhan Islam', 'Grace Okafor', 'Hasan Mahmud',
];

const enrollments: Rec[] = STUDENT_NAMES.map((name, i) => ({
  id: `5${String(i).padStart(12, '0')}`,
  [E.student]: { id: `6${String(i).padStart(12, '0')}`, name },
  [E.class]: { id: classes[0]!.id, name: classes[0]![C.name] },
  [E.status]: 'Active',
}));

// One student already marked, so the "merge existing marks" path is exercised.
const attendance: Rec[] = [
  { id: '7000000000001',
    [A.class_session]: { id: sessions[0]!.id },
    [A.enrollment]: { id: enrollments[2]!.id },
    [A.status]: 'Late' },
];

let nextId = 8000000000000;
const all = (): Rec[] =>
  [...terms, ...teachers, ...classes, ...allocations, ...sessions, ...enrollments, ...attendance];

/** Reads values out of the criteria strings client.ts builds. */
function valueFor(query: string, field: string): string | null {
  return new RegExp(`${field}:equals:([^)]+)`).exec(query)?.[1] ?? null;
}
function valuesFor(query: string, field: string): string[] {
  return [...query.matchAll(new RegExp(`${field}:equals:([^)]+)`, 'g'))].map((m) => m[1]!);
}
const lookupIs = (rec: Rec, field: string, id: string | null) =>
  (rec[field] as { id?: string } | null)?.id === id;

export function installMockZoho(): void {
  const M = ZOHO_MODULES;

  const api = {
    async getRecord({ RecordID }: { Entity: string; RecordID: string }) {
      const hit = all().find((r) => r.id === RecordID);
      return { data: hit ? [hit] : [] };
    },

    async getAllRecords() {
      return { data: [] };
    },

    async searchRecord({ Entity, Query }: { Entity: string; Query: string }) {
      if (Entity === M.terms.module) {
        const wanted = valuesFor(Query, T.status);
        return { data: terms.filter((t) => wanted.includes(String(t[T.status]))) };
      }
      if (Entity === M.teachers.module) return { data: teachers };
      if (Entity === M.classes.module) {
        const termId = valueFor(Query, C.term);
        return { data: classes.filter((c) => lookupIs(c, C.term, termId)) };
      }
      if (Entity === M.allocations.module) {
        const classId = valueFor(Query, AL.class);
        return { data: allocations.filter((a) => lookupIs(a, AL.class, classId)) };
      }
      if (Entity === M.class_sessions.module) {
        const date = valueFor(Query, S.session_date);
        return { data: sessions.filter((s) => s[S.session_date] === date) };
      }
      if (Entity === M.enrollments.module) {
        const classId = valueFor(Query, E.class);
        return { data: enrollments.filter((e) => lookupIs(e, E.class, classId)) };
      }
      if (Entity === M.attendance.module) {
        const sid = valueFor(Query, A.class_session);
        return { data: attendance.filter((a) => lookupIs(a, A.class_session, sid)) };
      }
      return { data: [] };
    },

    async insertRecord({ Entity, APIData }: { Entity: string; APIData: Record<string, unknown> | Array<Record<string, unknown>> }) {
      // Mirrors the real SDK: a single record or a bulk array, answered with one
      // status row per record. Without this the generator's 100-row batch would
      // insert a single malformed record here and look fine.
      const incoming = Array.isArray(APIData) ? APIData : [APIData];
      const made: Rec[] = [];
      for (const item of incoming) {
        const rec = { ...item, id: String(++nextId) } as Rec;
        if (Entity === M.attendance.module) attendance.push(rec);
        if (Entity === M.allocations.module) {
          rec[AL.effective_from] ??= today;
          allocations.push(rec);
        }
        if (Entity === M.class_sessions.module) sessions.push(rec);
        made.push(rec);
      }
      console.info('[mock] insert', Entity, made.length === 1 ? made[0] : `${made.length} records`);
      return { data: made.map((r) => ({ code: 'SUCCESS', details: { id: r.id } })) };
    },

    async updateRecord({ Entity, RecordID, APIData }: { Entity: string; RecordID: string; APIData: Record<string, unknown> }) {
      const target = all().find((r) => r.id === RecordID);
      if (target) Object.assign(target, APIData);
      console.info('[mock] update', Entity, RecordID, APIData);
      return { data: [{ code: 'SUCCESS', details: { id: RecordID } }] };
    },

    async deleteRecord({ RecordID }: { Entity: string; RecordID: string }) {
      return { data: [{ code: 'SUCCESS', details: { id: RecordID } }] };
    },
  };

  let onPageLoad: ((d: unknown) => void) | null = null;

  (globalThis as Record<string, unknown>).ZOHO = {
    embeddedApp: {
      on(_event: 'PageLoad', handler: (d: unknown) => void) { onPageLoad = handler; },
      async init() {
        // A web tab's PageLoad carries no record context -- mirror that exactly.
        setTimeout(() => onPageLoad?.({}), 120);
      },
    },
    CRM: { API: api },
  };

  console.info(
    '%c[mock] Zoho SDK replaced with in-memory fixtures - dev only.',
    'color:#0969da;font-weight:600',
  );
}
