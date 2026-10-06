// Builds a term's timetable: expands every class's weekly pattern into dated
// Class_Sessions rows.
//
// Why this lives in the app rather than only in scripts/seed-dummy.mjs: the
// script needs an OAuth token, whereas a web tab already holds an authenticated
// CRM session. A coordinator setting up a term should not have to mint
// credentials to do step 5 of the runbook -- see docs/new-term-workflow.md,
// which calls this step "pure mechanism" that "should not be done by hand".
//
// Re-running is safe. Existing (date, start_time) pairs per class are read
// first and skipped, matching the uq_session_per_class_date constraint, so a
// half-finished run can simply be repeated.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ZOHO_MODULES } from '../generated/types';
import { Loader, useDelayed } from './Loader';
import { Banner, Button, Card, Icon, Modal } from './ui';
import { shiftOf } from './status';
import {
  BULK_LIMIT,
  describeError,
  createClassSessionBatch,
  currentTerm,
  refId,
  refName,
  getClosedDates,
  getActiveTerms,
  getClassesForTerm,
  getSessionsForClass,
  sessionKeys,
  setSessionCancelled,
  plannedSessions,
  str,
  type PlannedSession,
  type RawRecord,
} from '../zoho/client';

// No 'none': the preview is derived from the counts now, and before they
// land the honest answer is 'counting' rather than a third empty state.
type Preview =
  | { kind: 'counting' }
  | {
      kind: 'ready';
      lessons: number;
      classes: number;
      existing: number;
      onHoliday: number;
      firstDate: string;
      lastDate: string;
    }
  | { kind: 'failed' };

/** One class's lessons, split into what is missing and what is not. */
interface ClassCount {
  classId: string;
  courseId: string;
  /** Its code and the time it meets, for naming a lesson of it in a list. */
  label: string;
  time: string;
  /** Which side of 13:00 the class meets, for the shift scope. */
  shift: '' | 'Morning' | 'Evening';
  missing: number;
  existing: number;
  onHoliday: number;
  /** The dates that would be created. */
  dates: string[];
  /** The lessons it already has, so the calendar can show and change them. */
  existingLessons: ExistingLesson[];
}

/** A lesson that exists, as the calendar needs to know it. */
interface ExistingLesson {
  id: string;
  date: string;
  cancelled: boolean;
  /** Which class it belongs to and when it meets, for naming it in a list. */
  label: string;
  time: string;
}

type Run =
  | { kind: 'idle' }
  | { kind: 'working'; done: number; total: number; label: string }
  | {
      kind: 'done';
      created: number;
      skipped: number;
      onHoliday: number;
      cancelled: number;
      restored: number;
    }
  | { kind: 'error'; message: string };

/** Mon-first, to match the week the rest of the app draws. */
const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** '2026-10' -> 'October 2026'. */
function monthLabel(month: string): string {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month} ${month.slice(0, 4)}`;
}

/** Six weeks of seven days: the most any month can span, and what every month
 *  is padded to. */
const CELLS_PER_MONTH = 42;

/**
 * One month as 7-column rows: leading blanks, every day of the month, then
 * trailing blanks out to a fixed six weeks.
 *
 * Always six, however few the month needs. A month spans five or six rows
 * depending on which weekday it opens on -- October 2026 starts on a Thursday
 * and fits in five, November starts on a Sunday and takes six -- and sized to
 * their contents the dialog grew and shrank by a row as you stepped between
 * them, moving the arrows and the footer out from under the pointer. A fixed
 * grid costs one empty row on some months and nothing else.
 *
 * Built from UTC so the grid cannot slide a day either way on a machine whose
 * timezone puts midnight on the other side of the date line -- the dates here
 * are plain yyyy-MM-dd strings with no time in them, and must stay that way.
 */
function monthCells(month: string): string[] {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const firstDay = new Date(Date.UTC(year, m - 1, 1));
  // getUTCDay is Sunday-first; the grid is Monday-first.
  const lead = (firstDay.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const cells: string[] = Array.from({ length: lead }, () => '');
  for (let d = 1; d <= days; d += 1) {
    cells.push(`${month}-${String(d).padStart(2, '0')}`);
  }
  while (cells.length < CELLS_PER_MONTH) cells.push('');
  return cells;
}

/** Is this class in the chosen course? '' means every course. */
function inCourse(klass: RawRecord, courseId: string, courseField: string): boolean {
  return courseId === '' || refId(klass[courseField]) === courseId;
}

export function GenerateSessions({
  onGenerated,
  initialTermId,
}: {
  onGenerated: () => void;
  /**
   * The term to open on, when the screen opening this already has one chosen.
   *
   * Without it the picker landed on whichever term getActiveTerms happened to
   * return first -- so a drawer opened from a board showing 2026 Term 3 led
   * with "all 33 lessons already exist for 2026 Term 2", which is both true
   * and about a term nobody asked about. Ignored if it is not among the active
   * terms, since a term that cannot be picked cannot be the default either.
   */
  initialTermId?: string;
}) {
  const [terms, setTerms] = useState<RawRecord[] | null>(null);
  const [termId, setTermId] = useState('');
  /* The term's classes, held rather than re-read per preview: narrowing to a
     course has to be instant, and the classes have not changed. */
  const [classes, setClasses] = useState<RawRecord[] | null>(null);
  /* Which course to generate for, '' meaning all of them.

     A term is eleven courses in eighteen classes, and "create 43 lessons"
     across all of them is a lot to agree to when the thing that prompted it
     was one class reading "No lessons yet". Narrowing the scope narrows the
     preview and the write to match, so the sentence above the button is about
     what you actually meant to do. */
  const [courseId, setCourseId] = useState('');
  const [run, setRun] = useState<Run>({ kind: 'idle' });
  /* What clicking would actually do, worked out up front: 'what does this
     mean' is answered far better by a concrete count than by any wording.
     null while counting, 'failed' if the reads did not come back. */
  const [counts, setCounts] = useState<ClassCount[] | null | 'failed'>(null);
  /* Dates the term is closed -- holidays, breaks. Kept so the calendar can
     show why a day in the middle of a pattern has no lesson on it. */
  const [closed, setClosed] = useState<ReadonlyMap<string, string>>(new Map());
  /* Dates the user has turned off, so they are not created.
     Empty means create everything, which is what the button offered before
     there was a way to say otherwise. Cleared whenever the term or the course
     changes -- a date excluded from one course's plan means nothing in
     another's, and silently carrying it over would drop a lesson nobody
     decided to drop. */
  /* Lessons not to create, as `classId|date`. Keyed per lesson for the same
     reason the flips are: a date is not one lesson. */
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  /* Whether the date picker is open. Three months of calendar is taller than
     the drawer, and inline it pushed the Create button -- the one thing you
     came here to press -- below the fold, with the course list above it gone
     too. It is also a question you answer once, which is what a modal is for. */
  const [datesOpen, setDatesOpen] = useState(false);
  /* Whether the pending changes are being read. A row on the panel, a list in
     a dialog: the panel says how many and the dialog says which, the same
     split the dates row already uses. */
  const [changesOpen, setChangesOpen] = useState(false);
  /* Which month the picker is showing, as '2026-10' rather than as a position
     in the list. Stepped rather than scrolled: a term is three or four months
     and a scrollbar under them was both the only thing saying there were more
     and an awkward way to reach them.

     The month itself, because the list it indexes into changes underneath it.
     Narrowing to Evening drops the months the evening classes do not run in,
     so index 2 of the old list and index 2 of the new one are different
     months -- switching shift jumped from October to November. A key stays
     pointing at October, and falls back to the first month when the new scope
     does not reach it at all. */
  const [monthKey, setMonthKey] = useState('');
  /* Dates whose existing lessons are to be flipped -- a live one called off, a
     cancelled one put back.

     One set rather than two, because the question a date answers is "is this
     different from how it is now", and a date cannot be both. Cleared with the
     term and the course for the same reason the skipped set is. */
  /* Session ids, not dates.
  
     A date can hold a morning lesson and an evening one -- two sections of the
     same course -- and keyed by date a single click took both. Ids are what is
     actually being changed, so narrowing the shift scope cannot leave a flip
     standing against a lesson you can no longer see. */
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
  /* Which half of the day to act on. '' is both, which is what a term being
     set up for the first time wants; narrowing is for the afternoon somebody
     needs to call off without touching the morning. */
  const [shiftScope, setShiftScope] = useState<'' | 'Morning' | 'Evening'>('');

  // Every (class|date|time) this component has written. A ref, not state:
  // it must survive a re-render without causing one, and it is read inside an
  // async run rather than during render.
  const createdKeys = useRef<Set<string>>(new Set());

  // One flag for both fetch phases, so they cannot chain two separate spinners.
  // Reads counts rather than the derived preview, which is declared further
  // down -- and says the same thing one step earlier.
  const preparingSlow = useDelayed(terms === null || counts === null);

  const T = ZOHO_MODULES.terms.fields;
  const K = ZOHO_MODULES.classes.fields;
  const S = ZOHO_MODULES.class_sessions.fields;

  useEffect(() => {
    let cancelled = false;
    getActiveTerms()
      .then((recs) => {
        if (cancelled) return;
        setTerms(recs);
        // The term asked for, else the one running today. recs[0] is the
        // earliest term getActiveTerms returns, which is only the right answer
        // in a school's first year.
        const asked = initialTermId && recs.some((r) => r.id === initialTermId)
          ? initialTermId
          : currentTerm(recs);
        if (asked) setTermId(asked);
      })
      .catch((err: unknown) => {
        if (!cancelled) setRun({ kind: 'error', message: describeError(err) });
      });
    return () => { cancelled = true; };
  }, [initialTermId]);

  // The term's classes, read once per term. Separate from the count below so
  // that changing course re-counts without re-reading them.
  useEffect(() => {
    if (!termId) return;
    let cancelled = false;
    setClasses(null);
    setCounts(null);
    setSkipped(new Set());
    setFlipped(new Set());
    setShiftScope('');
    // A course picked in one term means nothing in the next.
    setCourseId('');
    getClassesForTerm(termId)
      .then((cs) => { if (!cancelled) setClasses(cs); })
      .catch(() => { if (!cancelled) setCounts('failed'); });
    return () => { cancelled = true; };
  }, [termId]);

  /* The courses this term teaches, with how many classes each runs. Derived
     from the classes already in hand rather than read from the courses module:
     a course with no class this term cannot have lessons generated for it, so
     offering it would be offering an empty job. */
  const courses = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; classes: number }>();
    for (const klass of classes ?? []) {
      const id = refId(klass[K.course]);
      if (!id) continue;
      const found = byId.get(id);
      if (found) found.classes += 1;
      else byId.set(id, { id, name: refName(klass[K.course]) || id, classes: 1 });
    }
    /* How many lessons each course is still short of, so the list can say
       which ones are set up before you pick one. Without it every row read the
       same and finding the course you came for meant selecting them one at a
       time and reading the sentence underneath.

       Two numbers, not one. `missing` is how many lessons the course does not
       have, which is a fact about the term; `queued` is how many of those this
       run would create, which is a choice you are making. They were one number
       briefly and it made dropping every date from the review turn the whole
       list green -- a tick means the lessons exist, and those did not; they
       had just been taken out of the run. */
    const missing = new Map<string, number>();
    const queued = new Map<string, number>();
    for (const c of Array.isArray(counts) ? counts : []) {
      missing.set(c.courseId, (missing.get(c.courseId) ?? 0) + c.missing);
      const live = c.dates.filter((d) => !skipped.has(`${c.classId}|${d}`)).length;
      queued.set(c.courseId, (queued.get(c.courseId) ?? 0) + live);
    }
    return [...byId.values()]
      .map((c) => ({
        ...c,
        missing: missing.get(c.id) ?? 0,
        queued: queued.get(c.id) ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [classes, counts, skipped, K.course]);

  /* Counted per class, for every class in the term -- not just the course in
     scope.

     Scoping the fetch to the chosen course was cheaper per change but it could
     only ever answer the question already asked. The dropdown has to say which
     courses still need lessons before you pick one, and that is a count of all
     of them. Done once per term, picking a course then costs nothing at all
     rather than another fan-out. */
  useEffect(() => {
    if (!termId || classes === null) return;
    let cancelled = false;
    setCounts(null);

    (async () => {
      try {
        // Only classes that actually declare a pattern need checking, and their
        // session lookups are independent -- so they go in parallel. Awaiting
        // them one at a time made this six round trips deep for a six-class
        // term, which is what made the wait long enough to need a spinner.
        const scheduled = classes
          .map((klass) => ({ klass, planned: plannedSessions(klass) }))
          .filter((c) => c.planned.length > 0);

        const [sessionSets, closed] = await Promise.all([
          Promise.all(scheduled.map((c) => getSessionsForClass(c.klass.id))),
          getClosedDates(termId),
        ]);

        const out: ClassCount[] = scheduled.map((c, i) => {
          const sessions = sessionSets[i]!;
          const already = sessionKeys(sessions);
          const startTime = str(c.klass[K.start_time]);
          const label = str(c.klass[K.class_code], str(c.klass[K.name], c.klass.id));
          let missing = 0;
          let existing = 0;
          let onHoliday = 0;
          const dates: string[] = [];
          for (const session of c.planned) {
            // Closed dates are counted separately and never created. Folding
            // them into "already exists" would claim a lesson is on the
            // calendar when it deliberately is not.
            if (closed.has(session.date)) onHoliday += 1;
            // By date alone -- see sessionKeys. A lesson already on this date
            // is this lesson, whatever time it was written at.
            else if (already.has(session.date)) existing += 1;
            else { missing += 1; dates.push(session.date); }
          }
          /* Every lesson the class holds, not only the ones the pattern
             predicts. A lesson moved to a Friday by hand is still a lesson and
             still has to be cancellable from here -- counting it only when the
             rule would have produced it would hide exactly the ones somebody
             had already had to intervene on. */
          const existingLessons: ExistingLesson[] = sessions.map((r) => ({
            id: r.id,
            date: str(r[S.session_date]),
            cancelled: str(r[S.status]) === 'Cancelled',
            label,
            // The lesson's own time, not the class's: a lesson retimed by hand
            // is exactly the one somebody needs to pick out of a list.
            time: str(r[S.start_time]),
          }));
          return {
            classId: c.klass.id,
            courseId: refId(c.klass[K.course]) ?? '',
            label,
            time: startTime,
            shift: shiftOf(startTime),
            missing,
            existing,
            onHoliday,
            dates,
            existingLessons,
          };
        });

        if (!cancelled) {
          setCounts(out);
          setClosed(closed);
        }
      } catch {
        if (!cancelled) setCounts('failed');
      }
    })();

    return () => { cancelled = true; };
  }, [
    termId, classes,
    K.start_time, K.course, K.class_code, K.name,
    S.session_date, S.status, S.start_time,
  ]);

  /* What is on the table for the course in scope, as dates.

     Both the calendar and the preview are built from this, so the number on
     the button and the days that are lit can never disagree -- they are two
     renderings of one map. */
  const plan = useMemo(() => {
    const mine = Array.isArray(counts)
      ? counts.filter(
          (c) =>
            (courseId === '' || c.courseId === courseId) &&
            (shiftScope === '' || c.shift === shiftScope),
        )
      : [];
    /** date -> the lessons that would be created on it, as classId|date keys. */
    const toCreate = new Map<string, string[]>();
    for (const c of mine) {
      for (const d of c.dates) {
        const list = toCreate.get(d);
        if (list) list.push(`${c.classId}|${d}`);
        else toCreate.set(d, [`${c.classId}|${d}`]);
      }
    }
    /** date -> the lessons already on it, which can be called off or put back. */
    const taken = new Map<string, ExistingLesson[]>();
    for (const c of mine) {
      for (const lesson of c.existingLessons) {
        const list = taken.get(lesson.date);
        if (list) list.push(lesson);
        else taken.set(lesson.date, [lesson]);
      }
    }
    /* Which shifts the term actually runs, so the scope control can offer
       only the ones there is a choice between. A school with no evening
       classes should not be asked to pick a half of the day. */
    const shifts = new Set(
      (Array.isArray(counts) ? counts : [])
        .filter((c) => courseId === '' || c.courseId === courseId)
        .map((c) => c.shift),
    );
    return {
      classes: mine.length,
      toCreate,
      taken,
      shifts,
      existing: mine.reduce((n, c) => n + c.existing, 0),
      onHoliday: mine.reduce((n, c) => n + c.onHoliday, 0),
    };
  }, [counts, courseId, shiftScope]);

  /* The preview, folded out of the plan minus whatever has been turned off.
     No fetch: changing course or unticking a day is arithmetic over numbers
     already in hand. */
  const preview: Preview = useMemo(() => {
    if (counts === null) return { kind: 'counting' };
    if (counts === 'failed') return { kind: 'failed' };
    let lessons = 0;
    const dates: string[] = [];
    for (const [date, keys] of plan.toCreate) {
      const live = keys.filter((key) => !skipped.has(key)).length;
      if (live === 0) continue;
      lessons += live;
      dates.push(date);
    }
    dates.sort();
    return {
      kind: 'ready',
      lessons,
      classes: plan.classes,
      existing: plan.existing,
      onHoliday: plan.onHoliday,
      firstDate: dates[0] ?? '',
      lastDate: dates[dates.length - 1] ?? '',
    };
  }, [counts, plan, skipped]);

  /* Which lessons the flipped dates resolve to, split by direction. Computed
     once here rather than in the button, the preview and the write separately
     -- three places deriving the same thing from two sets is three chances to
     disagree about what the button is about to do. */
  const changes = useMemo(() => {
    /* Lessons this run would create: every planned date not turned off, named
       the same way the existing ones are so one list can hold all three kinds.
       Scoped like everything else -- these come from the plan, which is
       already narrowed to the course and shift on screen. */
    const create: { key: string; label: string; time: string; date: string }[] = [];
    const mine = Array.isArray(counts)
      ? counts.filter(
          (c) =>
            (courseId === '' || c.courseId === courseId) &&
            (shiftScope === '' || c.shift === shiftScope),
        )
      : [];
    for (const c of mine) {
      for (const date of c.dates) {
        const key = `${c.classId}|${date}`;
        if (skipped.has(key)) continue;
        create.push({ key, label: c.label, time: c.time, date });
      }
    }

    const cancel: ExistingLesson[] = [];
    const restore: ExistingLesson[] = [];
    /* Every class in the term, not only the ones in scope.

       These were walked from the scoped plan, which meant a lesson flipped
       under Both and then looked at under Evening left the list and the write
       without saying so -- you had made a choice and the view filter quietly
       unmade it. The course and shift pickers decide what the calendar draws;
       they do not decide which of your decisions count.

       Creations stay scoped, because those are not decisions -- they are
       whatever the chosen course is missing, and unscoping them would turn
       "set up Economics" into "set up the term". */
    for (const c of Array.isArray(counts) ? counts : []) {
      for (const lesson of c.existingLessons) {
        if (!flipped.has(lesson.id)) continue;
        (lesson.cancelled ? restore : cancel).push(lesson);
      }
    }
    const byDate = (a: { date: string; time: string }, b: { date: string; time: string }) =>
      a.date.localeCompare(b.date) || a.time.localeCompare(b.time);
    return {
      create: create.sort(byDate),
      cancel: cancel.sort(byDate),
      restore: restore.sort(byDate),
    };
  }, [flipped, counts, courseId, shiftScope, skipped]);

  /* The months the calendar draws: every month the term's lessons fall in,
     whatever is currently in scope.

     From all of the counts, not from the scoped plan. Built from the plan the
     list changed shape under every filter -- the evening classes run from
     October, so narrowing to Evening dropped September and the calendar moved
     to a different month than the one you were looking at. The scope decides
     which days are lit, never which months exist, and an empty September
     under Evening is the true answer: there are no evening lessons in it.

     Term-wide rather than course-wide for the same reason, one level up. */
  const months = useMemo(() => {
    const all = Array.isArray(counts) ? counts : [];
    const days = [
      ...all.flatMap((c) => c.dates),
      ...all.flatMap((c) => c.existingLessons.map((l) => l.date)),
    ];
    if (days.length === 0) return [];
    days.sort();
    const first = days[0]!.slice(0, 7);
    const last = days[days.length - 1]!.slice(0, 7);
    const out: string[] = [];
    let cursor = first;
    // Guarded rather than while(true): a bad date would otherwise spin here.
    for (let i = 0; i < 24 && cursor <= last; i += 1) {
      out.push(cursor);
      const y = Number(cursor.slice(0, 4));
      const m = Number(cursor.slice(5, 7));
      cursor = m === 12
        ? `${y + 1}-01`
        : `${y}-${String(m + 1).padStart(2, '0')}`;
    }
    return out;
  }, [counts]);

  /* Which of those months actually hold something under the current course and
     shift. The month list is deliberately the whole term's -- so narrowing a
     filter never moves the calendar -- which means the month in front of you
     can legitimately be empty, and the calendar has to say which ones are not
     rather than leaving you to step through looking. */
  const monthsWithLessons = useMemo(() => {
    const live = new Set<string>();
    for (const date of plan.toCreate.keys()) live.add(date.slice(0, 7));
    for (const date of plan.taken.keys()) live.add(date.slice(0, 7));
    return live;
  }, [plan]);

  /* Settle on an opening month, once, and then leave it alone.

     The empty key used to mean "work out a sensible month" and was re-read on
     every render -- so the answer changed with the filters it was derived
     from, and switching Morning to Evening moved the calendar from September
     to October because that is each scope's first month with lessons. Writing
     it down the first time the calendar has months turns it from a rule that
     keeps re-running into a choice that was made.

     After that only the arrows move it. A scope that empties the chosen month
     leaves it empty and says so, which is the honest answer and is what the
     note under the heading is for. */
  useEffect(() => {
    if (monthKey !== '' || months.length === 0) return;
    setMonthKey(months.find((m) => monthsWithLessons.has(m)) ?? months[0] ?? '');
  }, [monthKey, months, monthsWithLessons]);

  async function generate() {
    if (!termId) return;
    setRun({ kind: 'working', done: 0, total: 0, label: 'Reading classes…' });
    try {
      // Re-read rather than reuse what the preview holds: a class added or
      // retimed since the drawer opened should be in the plan, or out of it.
      const fresh = await getClassesForTerm(termId);

      // Work out the whole plan before writing anything, so the progress total
      // is real rather than a guess that creeps upward.
      const scheduled = fresh
        .filter((klass) => inCourse(klass, courseId, K.course))
        // The same scope the calendar was drawn under. Without it a run made
        // while narrowed to Evening would create the morning lessons too --
        // the ones deliberately out of view.
        .filter(
          (klass) =>
            shiftScope === '' || shiftOf(str(klass[K.start_time])) === shiftScope,
        )
        .map((klass) => ({ klass, planned: plannedSessions(klass) }))
        .filter((c) => c.planned.length > 0);

      // Parallel for the same reason as the preview above: independent reads.
      const [keySets, closed] = await Promise.all([
        Promise.all(scheduled.map((c) => getSessionsForClass(c.klass.id).then(sessionKeys))),
        getClosedDates(termId),
      ]);

      const plan: PlannedSession[] = [];
      let skippedCount = 0;
      let onHoliday = 0;
      scheduled.forEach((c, i) => {
        const existing = keySets[i]!;
        for (const s of c.planned) {
          const key = `${c.klass.id}|${s.date}`;
          // Belt and braces against a second run duplicating the timetable.
          // The read above is the primary guard, but Zoho does not enforce
          // uq_session_per_class_date natively, so anything this component has
          // already written in this page's lifetime is remembered rather than
          // trusted to come back from a read.
          // Turned off in the calendar. Counted with the rest of what was
          // left alone -- from the CRM's point of view a date nobody asked
          // for and a date that already exists are the same non-event.
          if (skipped.has(`${c.klass.id}|${s.date}`)) skippedCount += 1;
          else if (createdKeys.current.has(key)) skippedCount += 1;
          // Re-checked here rather than trusting the preview: a holiday added
          // between previewing and pressing would otherwise still be scheduled.
          else if (closed.has(s.date)) onHoliday += 1;
          else if (existing.has(s.date)) skippedCount += 1;
          else plan.push({ klass: c.klass, date: s.date, sequenceNo: s.sequenceNo });
        }
      });

      /* The status changes, before anything is written.

         First because they are the reversible half: a cancel that fails has
         changed nothing, while a create that fails has left part of a
         timetable behind. Doing them first also means a run that is only
         cancellations never reaches the batching below at all.

         One at a time -- the SDK's updateRecord takes a single record, there
         is no bulk form of it -- but a day's worth of cancellations is a
         handful of calls, not a term's worth. */
      // Everything flipped, wherever it was flipped from -- see the changes memo.
      const flips = [
        ...changes.cancel.map((l) => ({ id: l.id, cancelled: true })),
        ...changes.restore.map((l) => ({ id: l.id, cancelled: false })),
      ];
      for (let i = 0; i < flips.length; i += 1) {
        const flip = flips[i]!;
        setRun({
          kind: 'working',
          done: i,
          total: flips.length + plan.length,
          label: flip.cancelled ? 'cancelling' : 'restoring',
        });
        await setSessionCancelled(flip.id, flip.cancelled);
      }

      if (plan.length === 0) {
        setRun({
          kind: 'done',
          created: 0,
          skipped: skippedCount,
          onHoliday,
          cancelled: changes.cancel.length,
          restored: changes.restore.length,
        });
        // The counts behind the calendar have moved, so the next open has to
        // read them again rather than show what was true before this ran.
        setFlipped(new Set());
        onGenerated();
        return;
      }

      // One call per BULK_LIMIT records rather than one per record: 100 lessons
      // is a single request. Batches still go one after another so a failure
      // stops at a known point instead of leaving an unknown subset written.
      let written = 0;
      for (let i = 0; i < plan.length; i += BULK_LIMIT) {
        const batch = plan.slice(i, i + BULK_LIMIT);
        setRun({
          kind: 'working',
          done: written,
          total: plan.length,
          label: `batch of ${batch.length}`,
        });
        written += await createClassSessionBatch(batch);
        // Recorded only after the write returns, so a failed batch is not
        // mistaken for one already on the calendar.
        for (const item of batch) {
          createdKeys.current.add(`${item.klass.id}|${item.date}`);
        }
      }
      setRun({ kind: 'working', done: written, total: plan.length, label: 'finishing' });

      setRun({
        kind: 'done',
        created: written,
        skipped: skippedCount,
        onHoliday,
        cancelled: changes.cancel.length,
        restored: changes.restore.length,
      });
      setFlipped(new Set());
      onGenerated();
    } catch (err) {
      setRun({ kind: 'error', message: describeError(err) });
    }
  }

  if (run.kind === 'error') return <Banner tone="error">{run.message}</Banner>;

  // Two sequential fetches -- terms, then the per-term count -- used to show a
  // loader each, so arriving on an empty day flashed one after the other.
  // Treated as a single "preparing" state, and rendered as nothing at all until
  // it is slow enough to be worth mentioning: the surrounding empty state is
  // already meaningful without this block.
  if (terms === null || preview.kind === 'counting') {
    return preparingSlow ? <Loader label="Checking this term's lessons…" /> : null;
  }

  if (terms.length === 0)
    return <p className="muted">No open or running terms, so there is nothing to set up.</p>;

  if (run.kind === 'working') {
    const pct = run.total ? Math.round((run.done / run.total) * 100) : 0;
    return (
      <Card body prose>
        <Loader
          inline
          label={run.total ? `Creating lessons — ${run.done} of ${run.total} written (${run.label})` : run.label}
        />
        <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <p className="muted">Leave this tab open until it finishes.</p>
      </Card>
    );
  }

  if (run.kind === 'done') {
    return (
      <Card body prose>
        <p>
          Done — created <strong>{run.created}</strong> lesson{run.created === 1 ? '' : 's'}
          {run.cancelled > 0 && <> · <strong>{run.cancelled}</strong> cancelled</>}
          {run.restored > 0 && <> · <strong>{run.restored}</strong> put back</>}
          {run.skipped > 0 && <> · {run.skipped} already existed</>}
          {run.onHoliday > 0 && <> · {run.onHoliday} skipped as holidays or closures</>}.
          {' '}Pick a date inside the term to take a register.
        </p>
        <Button onClick={() => setRun({ kind: 'idle' })}>Set up another term</Button>
      </Card>
    );
  }

  // There used to be a collapsed "all N lessons already exist -- pick another
  // term" view here for a term with nothing left to generate. It has gone:
  // the calendar can now call a lesson off as well as create one, so a term
  // that is fully generated is precisely the one you would open this for, and
  // collapsing hid the only way to reach it.

  const counting = !Array.isArray(counts);
  const shortCourses = courses.filter((c) => c.missing > 0).length;

  /* What the button will do, worked out here rather than in three nested
     ternaries inside it. A run can create, cancel, put back, or any mix, and
     the label has to be the truth about the write -- "Create 19 lessons" over
     a run that is nine cancellations is a lie about what the button does. */
  const toCreate = preview.kind === 'ready' ? preview.lessons : 0;
  const toCancel = changes.cancel.length;
  const toRestore = changes.restore.length;
  /* "Call off", not "Cancel".

     Cancel on a primary button is the word for abandoning the dialog, not for
     what the dialog does -- "Cancel 5" sitting where the confirm button goes
     reads as a way out rather than as five lessons being called off. The
     status written is still Cancelled, and the rows in the review still say
     cancelling, because that is the CRM's word for the state; this is the one
     place where the word collides with a different meaning.

     The noun comes back when there is only one verb, because "Call off 5" is
     five of something and the button should say what. Two verbs and it would
     be "Create 19 lessons · Call off 2 lessons", which is longer than the
     button. */
  const parts = [
    toCreate > 0 ? `Create ${toCreate}` : '',
    toCancel > 0 ? `Call off ${toCancel}` : '',
    toRestore > 0 ? `Put back ${toRestore}` : '',
  ].filter(Boolean);
  const only = parts.length === 1;
  const total = toCreate + toCancel + toRestore;
  const applyLabel = parts.length === 0
    ? 'Create lessons'
    : parts.join(' · ') + (only ? ` lesson${total === 1 ? '' : 's'}` : '');

  return (
    /* No Card. This renders inside a drawer, which is already a panel with a
       title, a subtitle and its own padding -- a bordered, shadowed card
       inside it was a second frame around the first, and on a 30rem drawer
       that frame costs the width the content needed.

       The heading and the long explainer went with it for the same reason:
       the drawer header above says what this does, and saying it twice pushed
       the one thing you came to press below the fold. */
    <div className="gen">
      <p className="muted gen-intro">
        A class knows <em>when it meets</em> — “Mon and Wed, 09:00–10:30, 7 Sep
        to 11 Dec”. That is a rule, not a list of dates, and a register is taken
        against one date. This turns the rule into those dates, and lets you
        call one off when it is not going ahead. Nothing already on the
        calendar is touched unless you ask.
      </p>

      <label className="field gen-term">
        <span>Term</span>
        <select value={termId} onChange={(e) => setTermId(e.target.value)}>
          {terms.map((t) => (
            <option key={t.id} value={t.id}>
              {str(t[T.name], t.id)} ({str(t[T.start_date], '?')} → {str(t[T.end_date], '?')})
            </option>
          ))}
        </select>
      </label>

      {/* A list, not a dropdown. Eleven courses each carrying a state is a
          table of eleven answers, and a select shows one at a time -- you had
          to open it, read down it, and close it again to see anything, and the
          state could only be punctuation smuggled into the label.

          Open, each row states itself: the name, how many classes it runs, and
          whether its lessons exist. Only when there is a choice to make; one
          course in the term means the list can only repeat the term. */}
      {courses.length > 1 && (
        <div className="gen-courses">
          <div className="gen-courses-head">
            <span>Course</span>
            {!counting && (
              <span className="gen-courses-note">
                {shortCourses === 0
                  ? 'all set up'
                  : `${shortCourses} of ${courses.length} need lessons`}
              </span>
            )}
          </div>

          {/* All, first and selected by default: setting up a term is the
              common job and one course at a time is the exception, for when a
              class was added late or missed. */}
          <button
            type="button"
            className={`gen-course${courseId === '' ? ' is-on' : ''}`}
            aria-pressed={courseId === ''}
            onClick={() => { setCourseId(''); setSkipped(new Set()); setMonthKey(''); }}
          >
            <span className="gen-course-name">All {courses.length} courses</span>
            {!counting && (
              shortCourses === 0 ? (
                <span className="gen-course-state"><Icon name="check" size={14} /></span>
              ) : (
                <span className="gen-course-state is-short">{shortCourses} short</span>
              )
            )}
          </button>

          {courses.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`gen-course${courseId === c.id ? ' is-on' : ''}`}
              aria-pressed={courseId === c.id}
              onClick={() => { setCourseId(c.id); setSkipped(new Set()); setMonthKey(''); }}
            >
              <span className="gen-course-name">
                {c.name}
                {c.classes > 1 && (
                  <span className="gen-course-sub">{c.classes} classes</span>
                )}
              </span>
              {!counting && (
                /* The tick is about the term, the count is about this run.
                   A course with nothing missing is set up; one that is short
                   says how many this run will make; one that is short with
                   every date taken out says so plainly rather than wearing a
                   tick it has not earned. */
                c.missing === 0 ? (
                  <span className="gen-course-state"><Icon name="check" size={14} /></span>
                ) : c.queued > 0 ? (
                  <span className="gen-course-state is-short">{c.queued} to create</span>
                ) : (
                  <span className="gen-course-state is-off">{c.missing} not queued</span>
                )
              )}
            </button>
          ))}
        </div>
      )}

      {/* The dates themselves, to keep or drop one at a time.

          "19 to create" is a decision already made for you, and the one thing
          anyone actually wants to change about it is which days -- a fortnight
          lost to exams, a class that starts a week late, a Thursday the room
          is booked. The alternative was to generate the lot and delete what
          you did not want from the CRM afterwards.

          Only days the plan touches are live. A day with a lesson already on
          it is shown as taken rather than hidden, because "why is the 8th not
          selectable" is a question the calendar should answer by itself. */}
      {months.length > 0 && (
        <div className="gen-dates">
          <span className="gen-dates-label">Dates</span>
          {/* No count here. This row carried one for a while -- dates, then
              lessons -- and the Changes row below now says the same thing in
              the same unit as the button. Two tallies of one number, a line
              apart, are a thing to reconcile rather than read. */}
          <Button small onClick={() => setDatesOpen(true)}>
            <Icon name="calendar" size={14} />
            Choose
          </Button>
        </div>
      )}

      {datesOpen && (
        <Modal
          title="Choose dates"
          subtitle="Dark days will be created; green ones already exist. Click either to change it."
          onClose={() => setDatesOpen(false)}
          footer={
            <>
              <Button
                variant="ghost"
                small
                disabled={skipped.size === 0 && flipped.size === 0}
                onClick={() => { setSkipped(new Set()); setFlipped(new Set()); }}
              >
                Reset
              </Button>
              <span className="spacer" />
              <span className="muted gen-cal-note">{applyLabel}</span>
              <Button variant="primary" small onClick={() => setDatesOpen(false)}>
                Done
              </Button>
            </>
          }
        >
        {/* Which half of the day the grid is about.

            Only when the term runs both. A date that holds a morning lesson
            and an evening one is one square, and a click on it meant both --
            which is fine for setting a term up and wrong for calling off a
            single evening class. Narrowing the scope makes the square mean one
            lesson again. */}
        {plan.shifts.has('Morning') && plan.shifts.has('Evening') && (
          <div className="gen-shift seg">
            {([
              ['', 'Both'],
              ['Morning', 'Morning'],
              ['Evening', 'Evening'],
            ] as const).map(([value, label]) => (
              <Button
                key={value || 'both'}
                small
                className={shiftScope === value ? 'is-on' : undefined}
                aria-pressed={shiftScope === value}
                onClick={() => setShiftScope(value)}
              >
                {value === 'Morning' && <Icon name="sun" size={13} />}
                {value === 'Evening' && <Icon name="moon" size={13} />}
                {label}
              </Button>
            ))}
          </div>
        )}

        <div className="gen-cal">
          {/* One month at a time, stepped with the arrows.

              The month is held as '2026-10', never as a position: the list it
              sits in is rebuilt whenever the course or the shift changes, and
              a position means a different month in a shorter list -- which is
              what sent October to November on switching to Evening.

              If the new scope has no lessons in that month at all, the nearest
              later one wins, and failing that the last. Falling back to the
              first would throw you to the start of the term for the sake of a
              scope change, which is further than any of the arrows can move
              you in one press. */}
          {(() => {
            const at = (() => {
              if (months.length === 0) return 0;
              // Only for the render before the effect above writes the key.
              if (monthKey === '') return 0;
              const exact = months.indexOf(monthKey);
              if (exact >= 0) return exact;
              const after = months.findIndex((m) => m >= monthKey);
              return after >= 0 ? after : months.length - 1;
            })();
            const month = months[at] ?? '';
            return (
            <div className="gen-month">
              <div className="gen-nav">
                <Button
                  variant="ghost"
                  small
                  aria-label="Previous month"
                  disabled={at === 0}
                  onClick={() => setMonthKey(months[at - 1] ?? '')}
                >
                  <Icon name="arrow-left" size={15} />
                </Button>
                <h4>{monthLabel(month)}</h4>
                <Button
                  variant="ghost"
                  small
                  aria-label="Next month"
                  disabled={at >= months.length - 1}
                  onClick={() => setMonthKey(months[at + 1] ?? '')}
                >
                  <Icon name="arrow-right" size={15} />
                </Button>
              </div>
              {/* Which of the term's months this is, so stepping has somewhere
                  to go rather than ending without warning. */}
              {months.length > 1 && (
                <p className="gen-nav-of">{at + 1} of {months.length}</p>
              )}
              {/* A month a filter has emptied is drawn as an ordinary month
                  with nothing lit on it. There was a line here naming the next
                  month that had lessons; the grid already says the same thing
                  by being blank, and the arrows are directly above it. */}
              <div className="gen-grid">
                {WEEKDAY_INITIALS.map((d, i) => (
                  <span className="gen-dow" key={`${month}-dow-${i}`}>{d}</span>
                ))}
                {monthCells(month).map((date, i) => {
                  if (date === '') return <span className="gen-cell is-blank" key={`${month}-pad-${i}`} />;
                  const keys = plan.toCreate.get(date) ?? [];
                  const n = keys.length;
                  const lessons = plan.taken.get(date) ?? [];
                  const holiday = closed.get(date);
                  // Off when every lesson on it is off. One still in means the
                  // date is still doing something.
                  const off = keys.length > 0 && keys.every((key) => skipped.has(key));
                  const flip =
                    lessons.length > 0 && lessons.every((l) => flipped.has(l.id));
                  const day = Number(date.slice(8, 10));

                  /* A date that already has lessons. Clickable in the other
                     direction: off calls them off, on puts them back.

                     Cancelled, not deleted. A lesson that has had a register
                     taken against it owns attendance rows, and deleting the
                     record would leave them pointing at nothing -- and the
                     register screen already knows how to refuse a cancelled
                     lesson and say why. */
                  if (n === 0 && lessons.length > 0) {
                    const live = lessons.filter((l) => !l.cancelled).length;
                    const dead = lessons.length - live;
                    // Mixed dates follow the majority: one click should have
                    // one meaning, and the common case by far is all-or-none.
                    const goingOff = live >= dead;
                    return (
                      <button
                        type="button"
                        key={date}
                        className={[
                          'gen-cell is-taken',
                          live === 0 ? 'is-cancelled' : '',
                          flip ? (goingOff ? 'is-dropping' : 'is-reviving') : '',
                        ].filter(Boolean).join(' ')}
                        aria-pressed={flip}
                        /* Every lesson on the date, within the current shift
                           scope -- which is what makes narrowing to Evening
                           the way to call off an evening lesson without
                           touching the morning one beside it. */
                        title={
                          flip
                            ? goingOff
                              ? `${date} — will be cancelled`
                              : `${date} — will be put back`
                            : live > 0
                              ? `${date} — ${live} lesson${live === 1 ? '' : 's'}, click to cancel`
                              : `${date} — cancelled, click to put back`
                        }
                        onClick={() =>
                          setFlipped((prev) => {
                            const next = new Set(prev);
                            if (flip) for (const l of lessons) next.delete(l.id);
                            else for (const l of lessons) next.add(l.id);
                            return next;
                          })
                        }
                      >
                        {day}
                        {lessons.length > 1 && <i className="gen-cell-n">{lessons.length}</i>}
                      </button>
                    );
                  }

                  if (n === 0) {
                    return (
                      <span
                        className={`gen-cell${holiday ? ' is-closed' : ''}`}
                        key={date}
                        title={holiday ? `Closed — ${holiday}` : undefined}
                      >
                        {day}
                      </span>
                    );
                  }

                  return (
                    <button
                      type="button"
                      key={date}
                      className={`gen-cell is-plan${off ? ' is-off' : ''}`}
                      aria-pressed={!off}
                      title={`${date} — ${n} lesson${n === 1 ? '' : 's'}${off ? ', not creating' : ''}`}
                      onClick={() =>
                        setSkipped((prev) => {
                          const next = new Set(prev);
                          // All on or all off, from whichever way round it is
                          // now: a half-skipped date would have no state the
                          // cell could show.
                          if (off) for (const key of keys) next.delete(key);
                          else for (const key of keys) next.add(key);
                          return next;
                        })
                      }
                    >
                      {day}
                      {/* How many lessons land on this day, when it is more
                          than one -- a course with two sections meeting the
                          same day is two lessons behind one number. Narrow the
                          shift above and they separate. */}
                      {n > 1 && <i className="gen-cell-n">{n}</i>}
                    </button>
                  );
                })}
              </div>
            </div>
            );
          })()}

          <p className="gen-key">
            <span className="gen-key-item"><i className="gen-swatch is-plan" /> will create</span>
            <span className="gen-key-item"><i className="gen-swatch is-off" /> turned off</span>
            <span className="gen-key-item"><i className="gen-swatch is-taken" /> already there</span>
            <span className="gen-key-item"><i className="gen-swatch is-dropping" /> cancelling</span>
            <span className="gen-key-item"><i className="gen-swatch is-closed" /> closed</span>
          </p>
        </div>
        </Modal>
      )}

      {/* How many lessons are about to change, and the way to see which.

          A row, not the list itself. The list was inline here for a while and
          a term's worth of cancellations is a wall of rows between the dates
          and the button that writes them -- while the question it answers,
          "which lesson on the 7th", is asked once and then done with. Same
          split as the dates row above it: the panel counts, a dialog names. */}
      {toCreate + toCancel + toRestore > 0 && (
        <div className="gen-dates">
          <span className="gen-dates-label">Changes</span>
          <span className="gen-dates-count">
            {[
              toCreate > 0 ? `${toCreate} creating` : '',
              toCancel > 0 ? `${toCancel} cancelling` : '',
              toRestore > 0 ? `${toRestore} putting back` : '',
            ].filter(Boolean).join(' · ')}
          </span>
          <Button small onClick={() => setChangesOpen(true)}>
            <Icon name="list" size={14} />
            Review
          </Button>
        </div>
      )}

      {changesOpen && (
        <Modal
          title="Pending changes"
          subtitle="Everything this run will do, lesson by lesson. Nothing is written until you press Create."
          onClose={() => setChangesOpen(false)}
          footer={
            <>
              <Button
                variant="ghost"
                small
                onClick={() => { setFlipped(new Set()); setSkipped(new Set()); }}
              >
                Reset
              </Button>
              <span className="spacer" />
              <Button variant="primary" small onClick={() => setChangesOpen(false)}>
                Done
              </Button>
            </>
          }
        >
          {/* Creations first, then cancellations, then restorations: the
              order the run itself writes them in, near enough, and the order
              that puts the bulk of a first-time setup at the top where its
              count is least surprising.

              One list, not three: a reader counting what a button is about to
              do should not have to add up three sections, and each row says
              its own verb. */}
          <ul className="gen-changes">
            {changes.create.map((lesson) => (
              <li key={lesson.key} className="is-create">
                <Icon name="plus" size={14} />
                <span className="gen-change-what">
                  <strong>{lesson.label}</strong>
                  <span className="gen-change-when">
                    {lesson.date}
                    {lesson.time && ` · ${lesson.time}`}
                  </span>
                </span>
                <span className="gen-change-verb">creating</span>
                {/* Turns this one date off, exactly as clicking its square in
                    the calendar would. */}
                <Button
                  variant="ghost"
                  small
                  aria-label={`Do not create ${lesson.label} on ${lesson.date}`}
                  onClick={() =>
                    setSkipped((prev) => new Set(prev).add(lesson.key))
                  }
                >
                  <Icon name="close" size={13} />
                </Button>
              </li>
            ))}

            {[...changes.cancel, ...changes.restore].map((lesson) => {
              const going = !lesson.cancelled;
              return (
                <li key={lesson.id} className={going ? 'is-cancel' : 'is-restore'}>
                  <Icon name={going ? 'slash' : 'rotate'} size={14} />
                  <span className="gen-change-what">
                    <strong>{lesson.label}</strong>
                    <span className="gen-change-when">
                      {lesson.date}
                      {lesson.time && ` · ${lesson.time}`}
                    </span>
                  </span>
                  <span className="gen-change-verb">
                    {going ? 'cancelling' : 'putting back'}
                  </span>
                  {/* Undoes this one. The alternative is finding its square in
                      the calendar, under whatever scope reveals it. */}
                  <Button
                    variant="ghost"
                    small
                    aria-label={`Leave ${lesson.label} on ${lesson.date} as it is`}
                    onClick={() =>
                      setFlipped((prev) => {
                        const next = new Set(prev);
                        next.delete(lesson.id);
                        return next;
                      })
                    }
                  >
                    <Icon name="close" size={13} />
                  </Button>
                </li>
              );
            })}
          </ul>
        </Modal>
      )}

      {preview.kind === 'failed' && (
        <Banner tone="error">Could not read this term's classes.</Banner>
      )}

      {/* The verdict and the button that acts on it, together at the end. */}
      <div className="gen-foot">
        {/* Named for what it will actually do. A run can now create, cancel,
            or both, and "Create 19 lessons" over a run that is nine
            cancellations would be a lie about a write. */}
        <Button
          variant="primary"
          onClick={generate}
          disabled={
            !termId || preview.kind !== 'ready' || toCreate + toCancel + toRestore === 0
          }
        >
          {applyLabel}
        </Button>

        {preview.kind === 'ready' && (
          <p className="muted preview">
            {preview.classes === 0 ? (
              <>
                {courseId === '' ? "None of this term's classes" : 'No class on this course'}{' '}
                says which days they meet, so there is nothing to create. Add
                meeting days to the classes first.
              </>
            ) : preview.lessons === 0 ? (
              <>
                Every lesson {courseId === '' ? 'for this term' : 'on this course'} already
                exists ({preview.existing} in total). Nothing to do.
              </>
            ) : (
              <>
                Will create <strong>{preview.lessons} lessons</strong> across{' '}
                {preview.classes} class{preview.classes === 1 ? '' : 'es'}, from{' '}
                {preview.firstDate} to {preview.lastDate}
                {preview.existing > 0 && <> · {preview.existing} already exist</>}
                {preview.onHoliday > 0 && (
                  <> · <strong>{preview.onHoliday} skipped</strong> as holidays or closures</>
                )}.
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
