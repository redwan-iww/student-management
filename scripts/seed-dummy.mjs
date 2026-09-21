// Builds (and optionally posts) the dummy dataset described in
// dummy-data-instructions.txt:
//
//   - three 70-day terms
//   - six separate courses per term
//   - two parents; one student under the first, two under the second
//   - the three students admitted across the three separate terms
//   - class allocation for them
//
// Module and field api_names are never hard-coded: they come from
// build/types.ts via ZOHO_MODULES, so a rename in schema/model.yaml breaks this
// script at the call site instead of writing to a field that no longer exists.
//
//   node scripts/seed-dummy.mjs --out seed/dummy-data.json
//   node scripts/seed-dummy.mjs --token <oauth-access-token> [--api https://www.zohoapis.com]
//
// Posting is dependency-ordered: each stage resolves the ids the next one needs.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// pathToFileURL, not the bare path: on Windows an absolute path like
// C:\... is read as a URL scheme by the ESM loader and rejected.
const { ZOHO_MODULES: M } = await import(pathToFileURL(join(ROOT, 'build', 'types.ts')).href);

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1];
};
const OUT = arg('out');
const TOKEN = arg('token');
const API = arg('api') ?? 'https://www.zohoapis.com';

// ---------------------------------------------------------------------------
// dates -- a "70 day term" is 70 days inclusive, so end = start + 69
// ---------------------------------------------------------------------------
const iso = (d) => d.toISOString().slice(0, 10);
const plusDays = (isoDate, days) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
};
const TERM_LENGTH_DAYS = 70;

const TERM_STARTS = ['2026-10-05', '2027-01-04', '2027-04-05'];

// ---------------------------------------------------------------------------
// the shape of the data
// ---------------------------------------------------------------------------
const SUBJECTS = [
  { key: 'MATH', program: 'Mathematics', course: 'Mathematics' },
  { key: 'ENG', program: 'English Language', course: 'English' },
  { key: 'PHY', program: 'Physical Sciences', course: 'Physics' },
  { key: 'CHEM', program: 'Physical Sciences', course: 'Chemistry' },
  { key: 'BIO', program: 'Life Sciences', course: 'Biology' },
  { key: 'ICT', program: 'Computing', course: 'Information Technology' },
];

const PARENTS = [
  {
    household: 'Ahmed Household',
    code: 'HH-1001',
    guardian: 'Farhana Ahmed',
    relationship: 'Mother',
    email: 'farhana.ahmed@example.com',
    phone: '01822000001',
    students: [{ first: 'Rafi', last: 'Ahmed', dob: '2010-03-14', gender: 'Male', termIndex: 0 }],
  },
  {
    household: 'Siddique Household',
    code: 'HH-1002',
    guardian: 'Mizanur Siddique',
    relationship: 'Father',
    email: 'mizanur.siddique@example.com',
    phone: '01822000002',
    students: [
      { first: 'Nusrat', last: 'Siddique', dob: '2009-08-22', gender: 'Female', termIndex: 1 },
      { first: 'Tanvir', last: 'Siddique', dob: '2011-01-09', gender: 'Male', termIndex: 2 },
    ],
  },
];

const ROOMS = ['Room 101', 'Room 102', 'Room 201', 'Room 202', 'Lab 1', 'Lab 2'];
const SLOTS = [
  { start: '09:00', end: '10:30', days: ['Monday', 'Wednesday'] },
  { start: '11:00', end: '12:30', days: ['Monday', 'Wednesday'] },
  { start: '09:00', end: '10:30', days: ['Tuesday', 'Thursday'] },
  { start: '11:00', end: '12:30', days: ['Tuesday', 'Thursday'] },
  { start: '14:00', end: '15:30', days: ['Saturday'] },
  { start: '16:00', end: '17:30', days: ['Saturday'] },
];

// ---------------------------------------------------------------------------
// build the payloads
// ---------------------------------------------------------------------------
const T = M.terms.fields;
const P = M.programs.fields;
const C = M.courses.fields;
const H = M.households.fields;
const S = M.students.fields;
const K = M.classes.fields;
const A = M.admissions.fields;
const E = M.enrollments.fields;
const AL = M.allocations.fields;

const terms = TERM_STARTS.map((start, i) => ({
  _ref: `term${i + 1}`,
  [T.name]: `Term ${i + 1} (${start.slice(0, 4)})`,
  [T.term_code]: `T${i + 1}-${start.slice(0, 4)}`,
  [T.academic_year]: Number(start.slice(0, 4)),
  [T.sequence_no]: i + 1,
  [T.start_date]: start,
  [T.end_date]: plusDays(start, TERM_LENGTH_DAYS - 1),
  [T.enrollment_opens]: plusDays(start, -45),
  [T.enrollment_closes]: plusDays(start, -3),
  [T.status]: i === 0 ? 'In Progress' : 'Open',
}));

const programNames = [...new Set(SUBJECTS.map((s) => s.program))];
const programs = programNames.map((name, i) => ({
  _ref: `program${i + 1}`,
  [P.name]: name,
  [P.program_code]: `PRG-${name.split(' ')[0].slice(0, 4).toUpperCase()}`,
  [P.description]: `${name} pathway.`,
  [P.level]: 'Intermediate',
  [P.duration_terms]: 3,
  [P.status]: 'Active',
}));

// Six separate courses per term -- distinct catalog entries, not shared.
const courses = [];
terms.forEach((term, ti) => {
  SUBJECTS.forEach((subject) => {
    const level = (ti + 1) * 100 + 1;
    courses.push({
      _ref: `course-${ti}-${subject.key}`,
      _programRef: programs[programNames.indexOf(subject.program)]._ref,
      [C.name]: `${subject.course} ${level}`,
      // course_code is unique org-wide, so it carries its term: a bare MATH101
      // collides with catalog entries seeded by earlier runs.
      [C.course_code]: `${subject.key}${level}-${term[T.term_code]}`,
      [C.description]: `${subject.course} for ${term[T.name]}.`,
      [C.level]: ti === 0 ? 'Beginner' : ti === 1 ? 'Intermediate' : 'Advanced',
      [C.contact_hours]: 30,
      [C.default_capacity]: 20,
      [C.default_fee]: 9000 + ti * 1500,
      [C.status]: 'Active',
    });
  });
});

const households = PARENTS.map((p, i) => ({
  _ref: `household${i + 1}`,
  [H.household_name]: p.household,
  // household_code is a server-generated autonumber (HH-{00000}) -- Zoho assigns
  // it on create and rejects a supplied value, so it is deliberately not sent.
  [H.primary_guardian_name]: p.guardian,
  [H.primary_guardian_relationship]: p.relationship,
  [H.email]: p.email,
  [H.phone]: p.phone,
  [H.preferred_contact_method]: 'Phone',
  [H.billing_status]: 'Current',
}));

const students = [];
PARENTS.forEach((p, pi) => {
  p.students.forEach((s, si) => {
    students.push({
      _ref: `student-${pi}-${si}`,
      _householdRef: households[pi]._ref,
      _termIndex: s.termIndex,
      [S.full_name]: `${s.first} ${s.last}`,
      [S.first_name]: s.first,
      [S.last_name]: s.last,
      [S.date_of_birth]: s.dob,
      [S.gender]: s.gender,
      [S.status]: 'Active',
      [S.enrollment_date]: TERM_STARTS[s.termIndex],
      [S.emergency_contact_name]: p.guardian,
      [S.emergency_contact_phone]: p.phone,
    });
  });
});

// One class per course, in that course's own term: 6 per term, 18 total.
const classes = courses.map((course, idx) => {
  const ti = Math.floor(idx / SUBJECTS.length);
  const slot = SLOTS[idx % SLOTS.length];
  const term = terms[ti];
  return {
    _ref: `class-${course._ref}`,
    _courseRef: course._ref,
    _termRef: term._ref,
    _teacherIndex: idx % 3,
    // course_code already ends in the term code -- don't repeat it here.
    [K.name]: `${course[C.course_code]}-A`,
    [K.class_code]: `${course[C.course_code]}-A`,
    [K.section_label]: 'A',
    [K.room]: ROOMS[idx % ROOMS.length],
    [K.capacity]: 20,
    [K.meeting_days]: slot.days,
    [K.start_time]: slot.start,
    [K.end_time]: slot.end,
    [K.start_date]: term[T.start_date],
    [K.end_date]: term[T.end_date],
    [K.status]: ti === 0 ? 'Running' : 'Scheduled',
  };
});

// Each student is admitted for a different term.
const admissions = students.map((student) => ({
  _ref: `admission-${student._ref}`,
  _householdRef: student._householdRef,
  _studentRef: student._ref,
  _termRef: terms[student._termIndex]._ref,
  // Admissions' display field is mandatory on create.
  [A.name]: `${student[S.full_name]} - ${terms[student._termIndex][T.term_code]}`,
  [A.applicant_first_name]: student[S.first_name],
  [A.applicant_last_name]: student[S.last_name],
  [A.applicant_date_of_birth]: student[S.date_of_birth],
  [A.applicant_gender]: student[S.gender],
  [A.guardian_name]: student[S.emergency_contact_name],
  [A.guardian_phone]: student[S.emergency_contact_phone],
  [A.source]: 'Referral',
  [A.stage]: 'Enrolled',
  [A.applied_date]: plusDays(TERM_STARTS[student._termIndex], -30),
  [A.decision_date]: plusDays(TERM_STARTS[student._termIndex], -14),
}));

// Each student takes all six classes of their own term.
const enrollments = [];
students.forEach((student) => {
  const term = terms[student._termIndex];
  classes
    .filter((k) => k._termRef === term._ref)
    .forEach((k) => {
      const course = courses.find((c) => c._ref === k._courseRef);
      enrollments.push({
        _ref: `enr-${student._ref}-${k._ref}`,
        _studentRef: student._ref,
        _classRef: k._ref,
        _courseRef: course._ref,
        _termRef: term._ref,
        [E.name]: `${student[S.full_name]} - ${k[K.class_code]}`,
        [E.status]: 'Active',
        [E.enrolled_on]: plusDays(term[T.start_date], -7),
        [E.fee_amount]: course[C.default_fee],
        [E.discount]: 0,
        [E.payment_status]: 'Unpaid',
      });
    });
});

// Class allocation: a lead teacher on every class the students actually attend.
const allocations = classes.map((k) => ({
  _ref: `alloc-${k._ref}`,
  _classRef: k._ref,
  _teacherIndex: k._teacherIndex,
  [AL.name]: `Lead - ${k[K.class_code]}`,
  [AL.role]: 'Lead Teacher',
  [AL.effective_from]: k[K.start_date],
  [AL.status]: 'Active',
}));

const dataset = { terms, programs, courses, households, students, classes, admissions, enrollments, allocations };

const counts = Object.fromEntries(Object.entries(dataset).map(([k, v]) => [k, v.length]));
console.log('dataset:', counts);
console.log(
  'terms:',
  terms.map((t) => `${t[T.name]} ${t[T.start_date]}..${t[T.end_date]}`).join(' | '),
);

// ---------------------------------------------------------------------------
// output
// ---------------------------------------------------------------------------
if (OUT) {
  const path = join(ROOT, OUT);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(dataset, null, 2) + '\n', 'utf8');
  console.log(`wrote ${path}`);
}

if (!TOKEN) {
  if (!OUT) console.log('\nnothing posted: pass --token <oauth-access-token> to write to the CRM');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// post, in dependency order
// ---------------------------------------------------------------------------
const ids = new Map();
const strip = (rec) => Object.fromEntries(Object.entries(rec).filter(([k]) => !k.startsWith('_')));

async function post(moduleApiName, records, label) {
  if (!records.length) return;
  const res = await fetch(`${API}/crm/v8/${moduleApiName}`, {
    method: 'POST',
    headers: { Authorization: `Zoho-oauthtoken ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: records.map(strip) }),
  });
  const body = await res.json();
  const rows = body?.data ?? [];
  rows.forEach((row, i) => {
    if (row.code === 'SUCCESS') ids.set(records[i]._ref, row.details.id);
    else console.error(`  ${label} [${i}] ${row.code}: ${row.message}`);
  });
  const ok = rows.filter((r) => r.code === 'SUCCESS').length;
  console.log(`${label}: ${ok}/${records.length}`);
}

const ref = (r) => ({ id: ids.get(r) });

console.log('\nposting...');
await post(M.terms.module, terms, 'terms');
await post(M.programs.module, programs, 'programs');
await post(
  M.courses.module,
  courses.map((c) => ({ ...c, [C.program]: ref(c._programRef) })),
  'courses',
);
await post(M.households.module, households, 'households');
await post(
  M.students.module,
  students.map((s) => ({ ...s, [S.household]: ref(s._householdRef) })),
  'students',
);
await post(
  M.classes.module,
  classes.map((k) => ({ ...k, [K.course]: ref(k._courseRef), [K.term]: ref(k._termRef) })),
  'classes',
);
await post(
  M.admissions.module,
  admissions.map((a) => ({
    ...a,
    [A.household]: ref(a._householdRef),
    [A.student]: ref(a._studentRef),
    [A.term]: ref(a._termRef),
  })),
  'admissions',
);
await post(
  M.enrollments.module,
  enrollments.map((e) => ({
    ...e,
    [E.student]: ref(e._studentRef),
    [E.class]: ref(e._classRef),
    [E.course]: ref(e._courseRef),
    [E.term]: ref(e._termRef),
  })),
  'enrollments',
);
console.log('\nallocations need teacher ids -- pass --teachers id1,id2,id3');
const teacherIds = (arg('teachers') ?? '').split(',').filter(Boolean);
if (teacherIds.length) {
  await post(
    M.allocations.module,
    allocations.map((a) => {
      const k = classes.find((c) => c._ref === a._classRef);
      return {
        ...a,
        [AL.teacher]: { id: teacherIds[a._teacherIndex % teacherIds.length] },
        [AL.class]: ref(a._classRef),
      };
    }),
    'allocations',
  );
}
