// Seeds the SQL database with the dataset described in
// dummy-data-instructions.txt:
//
//   - three 70-day terms
//   - six separate courses per term
//   - two parents; one student under the first, two under the second
//   - the three students admitted across the three separate terms
//   - class allocation for them
//   - class sessions expanded from each class's weekly pattern
//
// Writes through the REST API rather than opening the database, so it exercises
// the same path the app uses -- and so it will work unchanged against Supabase.
//
//   npm run server                      (in another terminal)
//   node scripts/seed-db.mjs
//   node scripts/seed-db.mjs --reset    delete existing rows first

const API = process.env.API_URL ?? 'http://localhost:3001/api';
const RESET = process.argv.includes('--reset');

async function api(path, init) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (res.status === 204) return null;
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${path} -> ${body?.code ?? res.status}: ${body?.message ?? res.statusText}`);
  }
  return body;
}

const insert = (table, rows) => api(`/${table}`, { method: 'POST', body: JSON.stringify(rows) });
const select = (table, qs = '') => api(`/${table}${qs}`);

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
    guardian: 'Farhana Ahmed',
    relationship: 'Mother',
    email: 'farhana.ahmed@example.com',
    phone: '01822000001',
    students: [{ first: 'Rafi', last: 'Ahmed', dob: '2010-03-14', gender: 'Male', termIndex: 0 }],
  },
  {
    household: 'Siddique Household',
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

const TEACHERS = [
  { full_name: 'Nadia Karim', email: 'nadia.karim@example.com' },
  { full_name: 'Priya Das', email: 'priya.das@example.com' },
  { full_name: 'Imran Chowdhury', email: 'imran.chowdhury@example.com' },
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

const WEEKDAY_INDEX = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
};

/** Expand a weekly pattern across a date range into dated meetings. */
function expand(days, start, end) {
  const wanted = new Set(days.map((d) => WEEKDAY_INDEX[d]));
  const out = [];
  const last = new Date(`${end}T00:00:00Z`);
  for (
    const cursor = new Date(`${start}T00:00:00Z`);
    cursor <= last;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    if (wanted.has(cursor.getUTCDay())) out.push(iso(cursor));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Delete in reverse dependency order so FK RESTRICT never blocks.
// ---------------------------------------------------------------------------
const WIPE_ORDER = [
  'attendance', 'allocations', 'enrollments', 'class_sessions', 'admissions',
  'classes', 'courses', 'programs', 'terms', 'students', 'teachers', 'households',
];

async function reset() {
  for (const table of WIPE_ORDER) {
    const rows = await select(table, '?select=id');
    for (const row of rows) await api(`/${table}/${row.id}`, { method: 'DELETE' });
    if (rows.length) console.log(`  cleared ${rows.length} from ${table}`);
  }
}

// ---------------------------------------------------------------------------
async function main() {
  await api('/health').catch(() => {
    throw new Error(`cannot reach ${API} -- is \`npm run server\` running?`);
  });

  if (RESET) {
    console.log('resetting...');
    await reset();
  }

  const counts = {};
  const note = (k, v) => { counts[k] = v; };

  // terms
  const terms = await insert('terms', TERM_STARTS.map((start, i) => ({
    name: `Term ${i + 1} (${start.slice(0, 4)})`,
    term_code: `T${i + 1}-${start.slice(0, 4)}`,
    academic_year: Number(start.slice(0, 4)),
    sequence_no: i + 1,
    start_date: start,
    end_date: plusDays(start, TERM_LENGTH_DAYS - 1),
    enrollment_opens: plusDays(start, -45),
    enrollment_closes: plusDays(start, -3),
    status: i === 0 ? 'In Progress' : 'Open',
  })));
  note('terms', terms.length);

  // programs
  const programNames = [...new Set(SUBJECTS.map((s) => s.program))];
  const programs = await insert('programs', programNames.map((name) => ({
    name,
    program_code: `PRG-${name.split(' ')[0].slice(0, 4).toUpperCase()}`,
    description: `${name} pathway.`,
    level: 'Intermediate',
    duration_terms: 3,
    status: 'Active',
  })));
  const programByName = new Map(programs.map((p) => [p.name, p.id]));
  note('programs', programs.length);

  // teachers
  const teachers = await insert('teachers', TEACHERS.map((t) => ({ ...t, status: 'Active' })));
  note('teachers', teachers.length);

  // courses -- six per term, each carrying its term in the code so the unique
  // constraint holds when the same subject runs again
  const coursePayload = [];
  terms.forEach((term, ti) => {
    for (const subject of SUBJECTS) {
      const level = (ti + 1) * 100 + 1;
      coursePayload.push({
        name: `${subject.course} ${level}`,
        course_code: `${subject.key}${level}-${term.term_code}`,
        program_id: programByName.get(subject.program),
        description: `${subject.course} for ${term.name}.`,
        level: ti === 0 ? 'Beginner' : ti === 1 ? 'Intermediate' : 'Advanced',
        contact_hours: 30,
        default_capacity: 20,
        default_fee: 9000 + ti * 1500,
        status: 'Active',
      });
    }
  });
  const courses = await insert('courses', coursePayload);
  note('courses', courses.length);

  // households + students
  const households = await insert('households', PARENTS.map((p) => ({
    household_name: p.household,
    primary_guardian_name: p.guardian,
    primary_guardian_relationship: p.relationship,
    email: p.email,
    phone: p.phone,
    preferred_contact_method: 'Phone',
    billing_status: 'Current',
  })));
  note('households', households.length);

  const studentPayload = [];
  const studentTermIndex = [];
  PARENTS.forEach((p, pi) => {
    for (const s of p.students) {
      studentPayload.push({
        full_name: `${s.first} ${s.last}`,
        first_name: s.first,
        last_name: s.last,
        date_of_birth: s.dob,
        gender: s.gender,
        household_id: households[pi].id,
        status: 'Active',
        enrollment_date: TERM_STARTS[s.termIndex],
        emergency_contact_name: p.guardian,
        emergency_contact_phone: p.phone,
      });
      studentTermIndex.push(s.termIndex);
    }
  });
  const students = await insert('students', studentPayload);
  note('students', students.length);

  // classes -- one per course, in that course's own term
  const classPayload = courses.map((course, idx) => {
    const ti = Math.floor(idx / SUBJECTS.length);
    const slot = SLOTS[idx % SLOTS.length];
    const term = terms[ti];
    return {
      name: `${course.course_code}-A`,
      class_code: `${course.course_code}-A`,
      course_id: course.id,
      term_id: term.id,
      section_label: 'A',
      primary_teacher_id: teachers[idx % teachers.length].id,
      room: ROOMS[idx % ROOMS.length],
      capacity: 20,
      meeting_days: slot.days,
      start_time: slot.start,
      end_time: slot.end,
      start_date: term.start_date,
      end_date: term.end_date,
      status: ti === 0 ? 'Running' : 'Scheduled',
    };
  });
  const classes = await insert('classes', classPayload);
  note('classes', classes.length);

  // admissions -- one per student, each for a different term
  const admissions = await insert('admissions', students.map((s, i) => {
    const ti = studentTermIndex[i];
    return {
      name: `${s.full_name} - ${terms[ti].term_code}`,
      applicant_first_name: s.first_name,
      applicant_last_name: s.last_name,
      applicant_date_of_birth: s.date_of_birth,
      applicant_gender: s.gender,
      guardian_name: s.emergency_contact_name,
      guardian_phone: s.emergency_contact_phone,
      household_id: s.household_id,
      student_id: s.id,
      term_id: terms[ti].id,
      source: 'Referral',
      stage: 'Enrolled',
      applied_date: plusDays(TERM_STARTS[ti], -30),
      decision_date: plusDays(TERM_STARTS[ti], -14),
    };
  }));
  note('admissions', admissions.length);

  // enrollments -- each student takes all six classes of their own term
  const enrollPayload = [];
  students.forEach((s, i) => {
    const term = terms[studentTermIndex[i]];
    for (const k of classes.filter((c) => c.term_id === term.id)) {
      const course = courses.find((c) => c.id === k.course_id);
      enrollPayload.push({
        name: `${s.full_name} - ${k.class_code}`,
        student_id: s.id,
        class_id: k.id,
        status: 'Active',
        enrolled_on: plusDays(term.start_date, -7),
        fee_amount: course.default_fee,
        discount: 0,
        payment_status: 'Unpaid',
      });
    }
  });
  const enrollments = await insert('enrollments', enrollPayload);
  note('enrollments', enrollments.length);

  // allocations -- a lead teacher on every class
  const allocations = await insert('allocations', classes.map((k, idx) => ({
    name: `Lead Teacher - ${k.class_code}`,
    teacher_id: teachers[idx % teachers.length].id,
    class_id: k.id,
    role: 'Lead Teacher',
    effective_from: k.start_date,
    status: 'Active',
  })));
  note('allocations', allocations.length);

  // class sessions -- the weekly pattern expanded into dated meetings
  const sessionPayload = [];
  for (const k of classes) {
    expand(k.meeting_days, k.start_date, k.end_date).forEach((date, i) => {
      sessionPayload.push({
        name: `${k.class_code} - ${date}`,
        class_id: k.id,
        session_date: date,
        start_time: k.start_time,
        end_time: k.end_time,
        sequence_no: i + 1,
        status: 'Scheduled',
        attendance_taken: false,
      });
    });
  }
  // Chunked so the request body stays bounded.
  let sessionCount = 0;
  for (let i = 0; i < sessionPayload.length; i += 200) {
    const batch = await insert('class_sessions', sessionPayload.slice(i, i + 200));
    sessionCount += batch.length;
  }
  note('class_sessions', sessionCount);

  console.log('seeded:', counts);
  console.log(
    'terms:',
    terms.map((t) => `${t.name} ${t.start_date}..${t.end_date}`).join(' | '),
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
