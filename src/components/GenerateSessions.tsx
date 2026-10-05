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
  getSessionKeysForClass,
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
  courseId: string;
  missing: number;
  existing: number;
  onHoliday: number;
  /** The dates that would be created. */
  dates: string[];
  /** The dates it already has, so the calendar can show them as taken. */
  existingDates: string[];
}

type Run =
  | { kind: 'idle' }
  | { kind: 'working'; done: number; total: number; label: string }
  | { kind: 'done'; created: number; skipped: number; onHoliday: number }
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
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  /* Whether the date picker is open. Three months of calendar is taller than
     the drawer, and inline it pushed the Create button -- the one thing you
     came here to press -- below the fold, with the course list above it gone
     too. It is also a question you answer once, which is what a modal is for. */
  const [datesOpen, setDatesOpen] = useState(false);
  /* Which month the picker is showing. Stepped rather than scrolled: a term
     is three or four months and a scrollbar under them was both the only
     thing saying there were more and an awkward way to reach them. */
  const [monthAt, setMonthAt] = useState(0);

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
    /* How many lessons each course is still short of, so the dropdown can say
       which ones are set up before you pick one. Without it every option read
       the same and finding the course you came for meant selecting them one
       at a time and reading the sentence underneath. */
    const missing = new Map<string, number>();
    for (const c of Array.isArray(counts) ? counts : []) {
      missing.set(c.courseId, (missing.get(c.courseId) ?? 0) + c.missing);
    }
    return [...byId.values()]
      .map((c) => ({ ...c, missing: missing.get(c.id) ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [classes, counts, K.course]);

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

        const [keySets, closed] = await Promise.all([
          Promise.all(scheduled.map((c) => getSessionKeysForClass(c.klass.id))),
          getClosedDates(termId),
        ]);

        const out: ClassCount[] = scheduled.map((c, i) => {
          const already = keySets[i]!;
          const startTime = str(c.klass[K.start_time]);
          let missing = 0;
          let existing = 0;
          let onHoliday = 0;
          const dates: string[] = [];
          const existingDates: string[] = [];
          for (const session of c.planned) {
            // Closed dates are counted separately and never created. Folding
            // them into "already exists" would claim a lesson is on the
            // calendar when it deliberately is not.
            if (closed.has(session.date)) onHoliday += 1;
            else if (already.has(`${session.date}|${startTime}`)) {
              existing += 1;
              existingDates.push(session.date);
            } else { missing += 1; dates.push(session.date); }
          }
          return {
            courseId: refId(c.klass[K.course]) ?? '',
            missing,
            existing,
            onHoliday,
            dates,
            existingDates,
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
  }, [termId, classes, K.start_time, K.course]);

  /* What is on the table for the course in scope, as dates.

     Both the calendar and the preview are built from this, so the number on
     the button and the days that are lit can never disagree -- they are two
     renderings of one map. */
  const plan = useMemo(() => {
    const mine = Array.isArray(counts)
      ? counts.filter((c) => courseId === '' || c.courseId === courseId)
      : [];
    /** date -> how many lessons would be created on it, across the scope. */
    const toCreate = new Map<string, number>();
    for (const c of mine) {
      for (const d of c.dates) toCreate.set(d, (toCreate.get(d) ?? 0) + 1);
    }
    const taken = new Set<string>();
    for (const c of mine) for (const d of c.existingDates) taken.add(d);
    return {
      classes: mine.length,
      toCreate,
      taken,
      existing: mine.reduce((n, c) => n + c.existing, 0),
      onHoliday: mine.reduce((n, c) => n + c.onHoliday, 0),
    };
  }, [counts, courseId]);

  /* The preview, folded out of the plan minus whatever has been turned off.
     No fetch: changing course or unticking a day is arithmetic over numbers
     already in hand. */
  const preview: Preview = useMemo(() => {
    if (counts === null) return { kind: 'counting' };
    if (counts === 'failed') return { kind: 'failed' };
    let lessons = 0;
    const dates: string[] = [];
    for (const [date, n] of plan.toCreate) {
      if (skipped.has(date)) continue;
      lessons += n;
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

  /* The months the calendar draws: those the plan touches, and no others. A
     term runs three or four, but a course added late may only need one. */
  const months = useMemo(() => {
    const days = [...plan.toCreate.keys(), ...plan.taken];
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
  }, [plan]);

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
        .map((klass) => ({ klass, planned: plannedSessions(klass) }))
        .filter((c) => c.planned.length > 0);

      // Parallel for the same reason as the preview above: independent reads.
      const [keySets, closed] = await Promise.all([
        Promise.all(scheduled.map((c) => getSessionKeysForClass(c.klass.id))),
        getClosedDates(termId),
      ]);

      const plan: PlannedSession[] = [];
      let skippedCount = 0;
      let onHoliday = 0;
      scheduled.forEach((c, i) => {
        const existing = keySets[i]!;
        const startTime = str(c.klass[K.start_time]);
        for (const s of c.planned) {
          const key = `${c.klass.id}|${s.date}|${startTime}`;
          // Belt and braces against a second run duplicating the timetable.
          // The read above is the primary guard, but Zoho does not enforce
          // uq_session_per_class_date natively, so anything this component has
          // already written in this page's lifetime is remembered rather than
          // trusted to come back from a read.
          // Turned off in the calendar. Counted with the rest of what was
          // left alone -- from the CRM's point of view a date nobody asked
          // for and a date that already exists are the same non-event.
          if (skipped.has(s.date)) skippedCount += 1;
          else if (createdKeys.current.has(key)) skippedCount += 1;
          // Re-checked here rather than trusting the preview: a holiday added
          // between previewing and pressing would otherwise still be scheduled.
          else if (closed.has(s.date)) onHoliday += 1;
          else if (existing.has(`${s.date}|${startTime}`)) skippedCount += 1;
          else plan.push({ klass: c.klass, date: s.date, sequenceNo: s.sequenceNo });
        }
      });

      if (plan.length === 0) {
        setRun({ kind: 'done', created: 0, skipped: skippedCount, onHoliday });
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
          createdKeys.current.add(`${item.klass.id}|${item.date}|${str(item.klass[K.start_time])}`);
        }
      }
      setRun({ kind: 'working', done: written, total: plan.length, label: 'finishing' });

      setRun({ kind: 'done', created: written, skipped: skippedCount, onHoliday });
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
          {run.skipped > 0 && <> · {run.skipped} already existed</>}
          {run.onHoliday > 0 && <> · {run.onHoliday} skipped as holidays or closures</>}.
          {' '}Pick a date inside the term to take a register.
        </p>
        <Button onClick={() => setRun({ kind: 'idle' })}>Set up another term</Button>
      </Card>
    );
  }

  // Nothing to do for this term: an empty date is then just a day nobody
  // teaches, not a setup step that was missed. Collapse to one line rather than
  // presenting a full explainer for a job already finished -- but keep the term
  // picker, since another term may still need generating.
  //
  // Only with every course in scope. Narrowed to one, "all N lessons already
  // exist" would be a claim about the term made from a count of one course --
  // and collapsing would take away the course picker needed to try another.
  if (courseId === '' && preview.kind === 'ready' && preview.lessons === 0 && preview.existing > 0) {
    return (
      <p className="muted generated">
        All {preview.existing} lessons already exist for{' '}
        <select value={termId} onChange={(e) => setTermId(e.target.value)}>
          {terms.map((t) => (
            <option key={t.id} value={t.id}>
              {str(t[T.name], t.id)}
            </option>
          ))}
        </select>{' '}
        — pick another term above to set one up.
      </p>
    );
  }

  const counting = !Array.isArray(counts);
  const shortCourses = courses.filter((c) => c.missing > 0).length;

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
        against one date. This turns the rule into those dates. Running it twice
        is harmless.
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
            onClick={() => { setCourseId(''); setSkipped(new Set()); setMonthAt(0); }}
          >
            <span className="gen-course-name">All {courses.length} courses</span>
            {!counting && (
              <span className={`gen-course-state${shortCourses > 0 ? ' is-short' : ''}`}>
                {shortCourses > 0 ? `${shortCourses} short` : <Icon name="check" size={14} />}
              </span>
            )}
          </button>

          {courses.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`gen-course${courseId === c.id ? ' is-on' : ''}`}
              aria-pressed={courseId === c.id}
              onClick={() => { setCourseId(c.id); setSkipped(new Set()); setMonthAt(0); }}
            >
              <span className="gen-course-name">
                {c.name}
                {c.classes > 1 && (
                  <span className="gen-course-sub">{c.classes} classes</span>
                )}
              </span>
              {!counting && (
                <span className={`gen-course-state${c.missing > 0 ? ' is-short' : ''}`}>
                  {c.missing > 0 ? `${c.missing} to create` : <Icon name="check" size={14} />}
                </span>
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
          <span className="gen-dates-count">
            {skipped.size > 0
              ? `${plan.toCreate.size - skipped.size} of ${plan.toCreate.size} days`
              : `${plan.toCreate.size} days`}
          </span>
          <Button small onClick={() => setDatesOpen(true)}>
            <Icon name="calendar" size={14} />
            Choose
          </Button>
        </div>
      )}

      {datesOpen && (
        <Modal
          title="Choose dates"
          subtitle="Every day a lesson would be created on. Turn one off and it is left alone."
          onClose={() => setDatesOpen(false)}
          footer={
            <>
              <Button
                variant="ghost"
                small
                disabled={skipped.size === 0}
                onClick={() => setSkipped(new Set())}
              >
                Reset
              </Button>
              <span className="spacer" />
              <span className="muted gen-cal-note">
                {plan.toCreate.size - skipped.size} of {plan.toCreate.size} days ·{' '}
                {preview.kind === 'ready' ? preview.lessons : '—'} lessons
              </span>
              <Button variant="primary" small onClick={() => setDatesOpen(false)}>
                Done
              </Button>
            </>
          }
        >
        <div className="gen-cal">
          {/* One month at a time, stepped with the arrows. Clamped rather than
              reset: narrowing to a course with a shorter plan can leave the
              index past the end, and a blank calendar reads as "no dates"
              rather than as "you are off the end of the list". */}
          {(() => {
            const at = Math.min(monthAt, months.length - 1);
            const month = months[at] ?? '';
            return (
            <div className="gen-month">
              <div className="gen-nav">
                <Button
                  variant="ghost"
                  small
                  aria-label="Previous month"
                  disabled={at === 0}
                  onClick={() => setMonthAt(at - 1)}
                >
                  <Icon name="arrow-left" size={15} />
                </Button>
                <h4>{monthLabel(month)}</h4>
                <Button
                  variant="ghost"
                  small
                  aria-label="Next month"
                  disabled={at >= months.length - 1}
                  onClick={() => setMonthAt(at + 1)}
                >
                  <Icon name="arrow-right" size={15} />
                </Button>
              </div>
              {/* Which of the term's months this is, so stepping has somewhere
                  to go rather than ending without warning. */}
              {months.length > 1 && (
                <p className="gen-nav-of">{at + 1} of {months.length}</p>
              )}
              <div className="gen-grid">
                {WEEKDAY_INITIALS.map((d, i) => (
                  <span className="gen-dow" key={`${month}-dow-${i}`}>{d}</span>
                ))}
                {monthCells(month).map((date, i) => {
                  if (date === '') return <span className="gen-cell is-blank" key={`${month}-pad-${i}`} />;
                  const n = plan.toCreate.get(date) ?? 0;
                  const taken = plan.taken.has(date);
                  const holiday = closed.get(date);
                  const off = skipped.has(date);
                  const day = Number(date.slice(8, 10));

                  if (n === 0) {
                    return (
                      <span
                        className={[
                          'gen-cell',
                          taken ? 'is-taken' : '',
                          holiday ? 'is-closed' : '',
                        ].filter(Boolean).join(' ')}
                        key={date}
                        title={
                          taken ? 'A lesson already exists on this date'
                            : holiday ? `Closed — ${holiday}`
                            : undefined
                        }
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
                          if (next.has(date)) next.delete(date);
                          else next.add(date);
                          return next;
                        })
                      }
                    >
                      {day}
                      {/* How many lessons land on this day, when it is more
                          than one -- a course with two sections meeting the
                          same day is two lessons behind one number. */}
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
            <span className="gen-key-item"><i className="gen-swatch is-closed" /> closed</span>
          </p>
        </div>
        </Modal>
      )}

      {preview.kind === 'failed' && (
        <Banner tone="error">Could not read this term's classes.</Banner>
      )}

      {/* The verdict and the button that acts on it, together at the end. */}
      <div className="gen-foot">
        <Button
          variant="primary"
          onClick={generate}
          disabled={!termId || preview.kind !== 'ready' || preview.lessons === 0}
        >
          {preview.kind === 'ready' && preview.lessons > 0
            ? `Create ${preview.lessons} lesson${preview.lessons === 1 ? '' : 's'}`
            : 'Create lessons'}
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
