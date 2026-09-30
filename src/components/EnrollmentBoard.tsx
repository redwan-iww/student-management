import { useCallback, useEffect, useMemo, useState } from 'react';
import { ZOHO_MODULES } from '../generated/types';
import { Loader, useDelayed } from './Loader';
import { Avatar, Badge, Banner, Button, Chip, Drawer, EmptyState, Icon, Toast } from './ui';
import { classTone, shiftOf, shortDays } from './status';
import {
  createEnrollmentBatch,
  BULK_LIMIT,
  deleteEnrollment,
  describeError,
  getActiveStudents,
  getAllocationsForClass,
  getAttendanceCountsForClass,
  getAdmissionsForTerm,
  getEnrollmentsForClass,
  getEnrollmentsForClasses,
  int,
  orgToday,
  refId,
  refName,
  str,
  strList,
  type NewEnrollment,
  type RawRecord,
} from '../zoho/client';

const C = ZOHO_MODULES.classes.fields;
const E = ZOHO_MODULES.enrollments.fields;
const A = ZOHO_MODULES.admissions.fields;
const ST = ZOHO_MODULES.students.fields;
const AL = ZOHO_MODULES.allocations.fields;
const T = ZOHO_MODULES.terms.fields;

/** Where the right-hand column gets its people from. */
type Source = 'admitted' | 'active';

/** A person to place, flattened from either an Admission or a Student row. */
interface Candidate {
  studentId: string;
  name: string;
  /** Application number and stage, or the student code -- whatever names them. */
  detail: string;
  /**
   * The programme the application was for. Empty on the All active source,
   * where the person is reached through the student record and there is no
   * application to read it from -- a student belongs to no programme.
   */
  programId: string;
}

/**
 * Putting students into this term's classes.
 *
 * The counterpart of the staffing view: that one answers "who teaches this",
 * this one answers "who is in it". They share the class list and the term
 * picker, which is why this lives in the same tab rather than a third one.
 *
 * A student belongs to *several* classes in a term -- one per subject -- so a
 * card is not used up by being dropped. It stays on the right, and only the
 * exact (student, class) pair it has already been dropped on is refused.
 */
export function EnrollmentBoard({
  term,
  classes,
  programOf,
  programId,
  onClearProgram,
}: {
  /**
   * The whole record, not just its id: the board needs the enrolment window
   * off it to say when someone is being added after applications closed.
   */
  term: RawRecord;
  classes: RawRecord[];
  /**
   * Class id -> its department, resolved by the page: a class names its course
   * but not its programme, and the mapping is shared with the staffing view.
   */
  programOf: Map<string, { id: string; name: string }>;
  /** The department chosen in the toolbar. Empty means all of them. */
  programId: string;
  /** Clears that choice. The picker lives in the toolbar, so this is the only
   *  way a panel down here can offer a way out of a filter that emptied it. */
  onClearProgram: () => void;
}) {
  const termId = term.id;
  const termLabel = str(term[T.name], 'this term');
  const [source, setSource] = useState<Source>('admitted');
  // Scrolling is not a way to find one student among a thousand, and there is
  // no server-side search to lean on -- the whole term is already in memory by
  // the time the board renders, so the filter is applied here.
  const [studentQuery, setStudentQuery] = useState('');
  const [classQuery, setClassQuery] = useState('');
  // Drop students who already have a class in whatever is currently in view.
  const [hidePlaced, setHidePlaced] = useState(false);
  // Three independent reads, deliberately not one call:
  //
  //   admissions   change with the term
  //   enrollments  change with the term and its classes
  //   students     change with neither -- the roll is not term-scoped at all
  //
  // They used to be fetched together, keyed on all three dependencies at once,
  // so flipping Admitted/All active re-read the enrolments of every class --
  // the most expensive request on the screen, and nothing to do with which
  // list of people is showing.
  const [admissions, setAdmissions] = useState<RawRecord[] | null>(null);
  const [enrollments, setEnrollments] = useState<RawRecord[] | null>(null);
  // Stays null until the roll is actually asked for: most visits never leave
  // Admitted, and this is the one read that never needs repeating.
  const [students, setStudents] = useState<RawRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A set, not one student. With a hundred to place across eleven classes,
  // one drag per placement is hundreds of drags -- and the held card scrolls
  // out of sight while you hunt for the class. Tick several, then send them to
  // a class in one go. Dragging still works and simply means "just this one".
  const [selected, setSelected] = useState<Candidate[]>([]);
  const [dragOver, setDragOver] = useState<string | null>(null);
  // Which class's detail panel is open, if any.
  const [openClass, setOpenClass] = useState<RawRecord | null>(null);
  const [busyClass, setBusyClass] = useState<string | null>(null);
  // What just happened. The Toast is itself the live region, so this is the
  // one channel -- sighted and otherwise -- rather than a visible message and
  // a separate hidden announcement that have to be kept in step.
  const [toast, setToast] = useState<{ tone: 'positive' | 'warn'; message: string } | null>(null);
  // Picking a student up and putting them down needs announcing, but does not
  // deserve a toast: it is a state the page already shows.
  const [announcement, setAnnouncement] = useState('');

  // Derived, not fetched. Switching source is now instant -- except the very
  // first time the roll is shown, which is the only case that needs a request.
  const candidates = useMemo((): Candidate[] | null => {
    if (source === 'admitted') {
      if (admissions === null) return null;
      return admissions
        .map((r): Candidate => ({
          studentId: refId(r[A.student]) ?? '',
          name: refName(r[A.student]),
          detail: [str(r[A.application_no]), str(r[A.stage])].filter(Boolean).join(' · '),
          programId: refId(r[A.program]) ?? '',
        }))
        .filter((c) => c.studentId);
    }
    if (students === null) return null;
    return students.map((r): Candidate => ({
      studentId: r.id,
      name: str(r[ST.full_name], r.id),
      detail: str(r[ST.student_code], '—'),
      programId: '',
    }));
  }, [source, admissions, students]);

  // Who has an application for this term, needed by the warnings whichever
  // list is on screen.
  const admittedIds = useMemo(
    () =>
      admissions === null
        ? null
        : new Set(
            admissions.map((r) => refId(r[A.student])).filter((id): id is string => Boolean(id)),
          ),
    [admissions],
  );

  // The two columns settle independently, so they say so independently.
  const selectedIds = useMemo(() => new Set(selected.map((c) => c.studentId)), [selected]);

  const toggle = useCallback((who: Candidate) => {
    setSelected((prev) =>
      prev.some((c) => c.studentId === who.studentId)
        ? prev.filter((c) => c.studentId !== who.studentId)
        : [...prev, who],
    );
  }, []);

  const loading = enrollments === null;
  const peopleLoading = candidates === null;
  const showSpinner = useDelayed(loading);
  const showPeopleSpinner = useDelayed(peopleLoading);

  // Depended on instead of `classes` itself. The prop is a fresh array on
  // every parent render, so an effect keyed on it would refetch forever --
  // the same loop the staffing view's memoised callback exists to avoid.
  const classKey = classes.map((k) => k.id).join(',');

  // Applications for this term.
  useEffect(() => {
    let cancelled = false;
    setAdmissions(null);
    setError(null);
    getAdmissionsForTerm(termId)
      .then((recs) => { if (!cancelled) setAdmissions(recs); })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(describeError(err));
        setAdmissions([]);
      });
    return () => { cancelled = true; };
  }, [termId]);

  // Seat counts and who is already placed. One request per class, so this is
  // keyed as narrowly as it can be.
  useEffect(() => {
    let cancelled = false;
    setEnrollments(null);
    setSelected([]);
    getEnrollmentsForClasses(classes.map((k) => k.id))
      .then((recs) => { if (!cancelled) setEnrollments(recs); })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(describeError(err));
        setEnrollments([]);
      });
    return () => { cancelled = true; };
    // classKey stands in for classes here, compared by value not identity.
  }, [termId, classKey]);

  // The roll, read at most once per mount. It carries no term, so neither
  // changing term nor toggling back and forth is a reason to read it again.
  useEffect(() => {
    if (source !== 'active' || students !== null) return;
    let cancelled = false;
    getActiveStudents()
      .then((recs) => { if (!cancelled) setStudents(recs); })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(describeError(err));
        setStudents([]);
      });
    return () => { cancelled = true; };
  }, [source, students]);

  // Which classes each student is already in, and how full each class is.
  // Both come off the one term-wide fetch rather than a query per class --
  // which is exactly what enrollments.term is denormalized for.
  const { classesOf, countOf } = useMemo(() => {
    const classesOf = new Map<string, Set<string>>();
    const countOf = new Map<string, number>();
    for (const e of enrollments ?? []) {
      const studentId = refId(e[E.student]);
      const classId = refId(e[E.class]);
      if (!studentId || !classId) continue;
      // A dropped enrollment still occupies the pair, but it is not a seat.
      if (str(e[E.status]) === 'Active') {
        countOf.set(classId, (countOf.get(classId) ?? 0) + 1);
      }
      let set = classesOf.get(studentId);
      if (!set) classesOf.set(studentId, (set = new Set()));
      set.add(classId);
    }
    return { classesOf, countOf };
  }, [enrollments]);

  const shownClasses = useMemo(() => {
    const q = classQuery.trim().toLowerCase();
    return classes.filter((k) => {
      if (programId && programOf.get(k.id)?.id !== programId) return false;
      if (!q) return true;
      return `${str(k[C.name])} ${str(k[C.class_code])} ${str(k[C.room])}`
        .toLowerCase()
        .includes(q);
    });
  }, [classes, classQuery, programId, programOf]);

  const classesFiltered = shownClasses.length !== classes.length;

  // The programme narrows the intake as well as the classes: an application
  // is made *for* a programme in a term, so "who did we admit into Science"
  // is a real question. It cannot narrow the All active source -- those people
  // are reached through the student record, which carries no programme.
  // How many classes each student holds *within the current view*: with a
  // programme selected that means classes of that department, otherwise every
  // class in the term.
  //
  // Both the card's chip and the "already placed" checkbox read this, so they
  // cannot disagree. They used to: the chip counted every class in the term
  // while the checkbox counted only the filtered ones, so a student filtered
  // to English could show "1 class" for a maths class they were in.
  const classesInView = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [studentId, classIds] of classesOf) {
      let n = 0;
      for (const classId of classIds) {
        if (!programId || programOf.get(classId)?.id === programId) n += 1;
      }
      if (n > 0) counts.set(studentId, n);
    }
    return counts;
  }, [classesOf, programId, programOf]);

  // Everything except the placed filter, so the checkbox can say how many it
  // would remove without the count circling back on itself.
  //
  // A student belongs to the selected programme if their application says so
  // *or* they already hold one of its classes. An application records a single
  // programme, but a pupil sits in classes from several -- a science-stream
  // child still takes English. Without the second clause the roster and the
  // list disagreed: ENG204 showed three enrolled while the list beside it
  // showed one, because the other two were admitted into Science.
  const eligiblePeople = useMemo(() => {
    const q = studentQuery.trim().toLowerCase();
    return (candidates ?? []).filter((c) => {
      if (
        programId &&
        source === 'admitted' &&
        c.programId !== programId &&
        !classesInView.has(c.studentId)
      ) {
        return false;
      }
      if (!q) return true;
      return `${c.name} ${c.detail}`.toLowerCase().includes(q);
    });
  }, [candidates, studentQuery, programId, source, classesInView]);

  const placedCount = eligiblePeople.filter((c) => classesInView.has(c.studentId)).length;

  const shownPeople = useMemo(
    () => (hidePlaced ? eligiblePeople.filter((c) => !classesInView.has(c.studentId)) : eligiblePeople),
    [eligiblePeople, hidePlaced, classesInView],
  );

  const peopleNarrowed = shownPeople.length !== (candidates?.length ?? 0);

  // Applications with the programme field left blank. They cannot match any
  // programme filter, so an empty result has two quite different causes --
  // "nobody applied for this department" and "nobody recorded a department" --
  // and saying the first when the second is true sends you looking for the
  // wrong problem.
  const untagged = useMemo(
    () => (candidates ?? []).filter((c) => !c.programId).length,
    [candidates],
  );
  const filteringByProgram = programId !== '' && source === 'admitted';

  // Applications for this term shut before it began. Placing someone now is
  // legitimate -- a pupil transferring in mid-term, say -- but it is worth
  // saying out loud, because the date is on the term record and nothing else
  // in the app ever reads it.
  const closesOn = str(term[T.enrollment_closes]);
  const windowClosed = closesOn !== '' && closesOn < orgToday();

  // The house rule: a student is admitted for each term they attend, so an
  // enrolment without an application for *this* term is not allowed. It can
  // only arise on the All active source -- every candidate on the Admitted
  // source has one by definition.
  //
  // Not enforced anywhere else: the schema has no link from an enrolment to an
  // application, and no validation behind it, so this screen is the only place
  // the rule exists. Someone working in the CRM module directly can still do
  // it. Worth knowing before trusting the data.
  const blockedBySelection = useMemo(
    () =>
      admittedIds === null ? [] : selected.filter((c) => !admittedIds.has(c.studentId)),
    [selected, admittedIds],
  );

  const openRoster = useMemo(() => {
    if (!openClass) return [];
    const rows: { enrollmentId: string; name: string }[] = [];
    const seen = new Set<string>();
    for (const e of enrollments ?? []) {
      if (refId(e[E.class]) !== openClass.id) continue;
      if (str(e[E.status]) !== 'Active') continue;
      const studentId = refId(e[E.student]);
      if (!studentId || seen.has(studentId)) continue;
      seen.add(studentId);
      rows.push({ enrollmentId: e.id, name: refName(e[E.student]) || '—' });
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }, [openClass, enrollments]);

  const removeEnrollment = useCallback(
    async (enrollmentId: string, name: string) => {
      try {
        await deleteEnrollment(enrollmentId);
        // Dropped locally rather than re-read, for the same reason a new row is
        // appended rather than re-read: the term-wide reads would not reflect
        // it yet, and every count on the board derives from this list.
        setEnrollments((prev) => (prev ?? []).filter((e) => e.id !== enrollmentId));
        setToast({ tone: 'positive', message: `Removed ${name} from this class.` });
      } catch (err) {
        setToast({ tone: 'warn', message: describeError(err) });
      }
    },
    [],
  );

  const enroll = useCallback(
    async (klass: RawRecord) => {
      if (busyClass || selected.length === 0) return;
      setBusyClass(klass.id);
      setError(null);
      const classLabel = str(klass[C.class_code], str(klass[C.name], klass.id));

      try {
        // Read once for the whole batch, through the relationship so it sees
        // rows written moments ago. Nothing server-side enforces the
        // (student, class) pair.
        const existing = await getEnrollmentsForClass(klass.id, false);
        const already = new Set(
          existing.map((r) => refId(r[E.student])).filter((id): id is string => Boolean(id)),
        );

        const rows: NewEnrollment[] = [];
        let skippedAlready = 0;
        let skippedNotAdmitted = 0;

        for (const who of selected) {
          if (admittedIds !== null && !admittedIds.has(who.studentId)) {
            skippedNotAdmitted += 1;
            continue;
          }
          if (already.has(who.studentId)) {
            skippedAlready += 1;
            continue;
          }
          rows.push({
            studentId: who.studentId,
            classId: klass.id,
            studentLabel: who.name,
            classLabel,
            courseId: refId(klass[C.course]) ?? undefined,
            termId,
          });
        }

        // Zoho takes 100 rows per request; a bigger selection is chunked.
        const ok: { row: NewEnrollment; id: string }[] = [];
        const failed: { studentLabel: string; reason: string }[] = [];
        for (let i = 0; i < rows.length; i += BULK_LIMIT) {
          const batch = await createEnrollmentBatch(rows.slice(i, i + BULK_LIMIT));
          ok.push(...batch.ok);
          failed.push(...batch.failed);
        }

        if (ok.length > 0) {
          // Appended, not re-read -- the term-wide reads would not show these
          // yet, and every count on the board derives from this list.
          setEnrollments((prev) => [
            ...(prev ?? []),
            ...ok.map(({ row, id }) => ({
              id,
              [E.student]: { id: row.studentId, name: row.studentLabel },
              [E.class]: { id: klass.id, name: classLabel },
              [E.term]: { id: termId },
              [E.status]: 'Active',
            })),
          ]);
          // Only the ones that landed leave the selection, so a retry targets
          // exactly what is left.
          const placed = new Set(ok.map((o) => o.row.studentId));
          setSelected((prev) => prev.filter((c) => !placed.has(c.studentId)));
        }

        const notes = [
          skippedAlready > 0 ? `${skippedAlready} already in it` : '',
          skippedNotAdmitted > 0 ? `${skippedNotAdmitted} without an application` : '',
          failed.length > 0 ? `${failed.length} rejected` : '',
        ].filter(Boolean);

        setToast({
          tone: ok.length > 0 ? 'positive' : 'warn',
          message:
            `${ok.length} enrolled in ${classLabel}` +
            (notes.length > 0 ? ` · skipped ${notes.join(', ')}` : '.'),
        });

        if (failed.length > 0) setError(failed.map((f) => `${f.studentLabel}: ${f.reason}`).join('; '));
      } catch (err) {
        setError(describeError(err));
      } finally {
        setBusyClass(null);
      }
    },
    [busyClass, selected, admittedIds, termId],
  );

  // Clears itself, because nothing else in this flow would. The timer is keyed
  // on the toast object, so a second outcome restarts it rather than inheriting
  // the remainder of the first one's.
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.tone === 'warn' ? 8000 : 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Escape puts the card back down, the same as it would cancel a drag.
  useEffect(() => {
    if (selected.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelected([]);
        setAnnouncement('Selection cleared.');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected.length]);

  return (
    <div className="board">
      {/* Announces holding and dropping a student; outcomes go to the toast. */}
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>

      {toast && (
        <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} />
      )}

      {openClass && (
        <ClassDetails
          klass={openClass}
          programName={programOf.get(openClass.id)?.name ?? ''}
          roster={openRoster}
          onRemove={removeEnrollment}
          onClose={() => setOpenClass(null)}
        />
      )}


      <div className="board-col">
        <div className="board-head">
          <h2>
            Students{' '}
            <span className="count">
              {peopleNarrowed
                ? `${shownPeople.length} of ${candidates?.length ?? 0}`
                : (candidates?.length ?? 0)}
            </span>
          </h2>
          <div className="seg">
            <Button
              className={source === 'admitted' ? 'is-on' : undefined}
              aria-pressed={source === 'admitted'}
              onClick={() => { setSource('admitted'); setSelected([]); }}
            >
              Applied this term
            </Button>
            <Button
              className={source === 'active' ? 'is-on' : undefined}
              aria-pressed={source === 'active'}
              onClick={() => { setSource('active'); setSelected([]); }}
            >
              All students
            </Button>
          </div>
        </div>

        {(candidates?.length ?? 0) > 8 && (
          <input
            type="text"
            className="board-search"
            value={studentQuery}
            placeholder="Find a student by name or code…"
            aria-label="Find a student"
            onChange={(e) => setStudentQuery(e.target.value)}
          />
        )}

        {/* Sticky, because with a hundred rows the selection is made at the top
            and forgotten by the time you have scrolled to the bottom. */}
        {!peopleLoading && selected.length === 0 && shownPeople.length > 0 && (
          <p className="muted board-count">
            Tick students, then choose a class.{' '}
            <button type="button" className="btn-link" onClick={() => setSelected(shownPeople)}>
              Select all {shownPeople.length}
            </button>
          </p>
        )}

        {selected.length > 0 && (
          <div className="select-bar">
            <span>
              <strong>{selected.length}</strong> selected
            </span>
            <Button small variant="ghost" onClick={() => setSelected([])}>
              Clear
            </Button>
            <Button
              small
              variant="ghost"
              onClick={() => setSelected(shownPeople)}
              disabled={selected.length === shownPeople.length}
            >
              Select all {shownPeople.length}
            </Button>
          </div>
        )}

        {!peopleLoading && placedCount > 0 && (
          <label className="board-toggle">
            <input
              type="checkbox"
              checked={hidePlaced}
              onChange={(e) => setHidePlaced(e.target.checked)}
            />
            Hide the {placedCount} already placed
          </label>
        )}

        {!peopleLoading && filteringByProgram && untagged > 0 && shownPeople.length > 0 && (
          <p className="muted board-count">
            {untagged} application{untagged === 1 ? '' : 's'} with no programme
            recorded {untagged === 1 ? 'is' : 'are'} not shown.
          </p>
        )}

        {!peopleLoading && programId && source === 'active' && (
          <p className="muted board-count">
            Showing the whole roll — a programme is recorded on an application,
            so it cannot narrow this list.
          </p>
        )}

        {peopleLoading && showPeopleSpinner && <Loader label="Loading students…" />}

        {!peopleLoading && candidates?.length === 0 && (
          <EmptyState
            icon="users"
            title={source === 'admitted' ? 'Nobody applied for this term' : 'No active students'}
            detail={
              source === 'admitted'
                ? 'Anyone who applied for this term lands here once accepted, with a student record behind them.'
                : 'Add them in the Students module, or admit them through Admissions.'
            }
          >
            {/* The prose used to tell you to switch lists. Better to offer it:
                an existing pupil not in this term's intake is the commonest
                reason for this panel to be showing at all. */}
            {source === 'admitted' && (
              <Button small onClick={() => { setSource('active'); setSelected([]); }}>
                Show all students
              </Button>
            )}
          </EmptyState>
        )}

        {!peopleLoading && (candidates?.length ?? 0) > 0 && shownPeople.length === 0 && (
          <EmptyState
            icon={studentQuery.trim() !== '' ? 'users' : 'slash'}
            title={
              studentQuery.trim() !== ''
                ? 'No match'
                : untagged === (candidates?.length ?? 0)
                  ? 'No programme recorded'
                  : 'Nobody in this programme'
            }
            detail={
              studentQuery.trim() !== ''
                ? `No student here matches “${studentQuery}”.`
                : untagged === (candidates?.length ?? 0)
                  ? `${untagged === 1 ? 'The one application' : `All ${untagged} applications`} for this term ${untagged === 1 ? 'has' : 'have'} no programme against ${untagged === 1 ? 'it' : 'them'}.`
                  : 'Nobody applied into this programme for this term.'
            }
          >
            {studentQuery.trim() !== '' ? (
              <Button small onClick={() => setStudentQuery('')}>
                Clear search
              </Button>
            ) : (
              <Button small onClick={onClearProgram}>
                Show all programmes
              </Button>
            )}
          </EmptyState>
        )}

        {!peopleLoading && shownPeople.length > 0 && (
          <>
            <StudentList
              people={shownPeople}
              classesInView={classesInView}
              selectedIds={selectedIds}
              disabled={busyClass !== null}
              onToggle={(who) => {
                toggle(who);
                // Whatever went wrong last time was about the last attempt.
                setError(null);
                setAnnouncement(
                  selectedIds.has(who.studentId)
                    ? `${who.name} removed from the selection.`
                    : `${who.name} selected.`,
                );
              }}
            />
          </>
        )}
      </div>

      <div className="board-col">
        <div className="board-head">
          <h2>
            Classes in {termLabel} <span className="count">{classes.length}</span>
          </h2>
        </div>

        {classes.length > 8 && (
          <input
            type="text"
            className="board-search"
            value={classQuery}
            placeholder="Filter classes by name, code or room…"
            aria-label="Filter classes"
            onChange={(e) => setClassQuery(e.target.value)}
          />
        )}

        {!loading && classesFiltered && shownClasses.length > 0 && (
          <p className="muted board-count">
            {shownClasses.length} of {classes.length}
          </p>
        )}

        {error && <Banner tone="error">{error}</Banner>}

        {!loading && windowClosed && (
          <Banner tone="warn" icon="calendar">
            Enrolment for <strong>{termLabel}</strong> closed on {closesOn}. Anyone
            added now is joining after the deadline.
          </Banner>
        )}

        {!loading && blockedBySelection.length > 0 && (
          <Banner tone="warn" icon="user">
            {blockedBySelection.length === 1 ? (
              <>
                <strong>{blockedBySelection[0]?.name}</strong> did not apply for{' '}
              </>
            ) : (
              <>
                <strong>{blockedBySelection.length} of the selected students</strong> did
                not apply for{' '}
              </>
            )}
            <strong>{termLabel}</strong>, and will be skipped. Add an application in
            the Admissions module first — a student applies for each term they attend.
          </Banner>
        )}

        {loading && showSpinner && <Loader label="Loading the board…" />}

        {!loading && classes.length === 0 && (
          <EmptyState
            icon="book"
            title="No classes in this term"
            detail="Add some in the Classes module, then come back."
          />
        )}

        {!loading && classes.length > 0 && shownClasses.length === 0 && (
          <EmptyState
            icon={classQuery.trim() !== '' ? 'book' : 'slash'}
            title={classQuery.trim() !== '' ? 'No match' : 'Nothing in this programme'}
            detail={
              classQuery.trim() !== ''
                ? `No class here matches “${classQuery}”.`
                : 'This term runs classes, but none in the programme selected above.'
            }
          >
            {classQuery.trim() !== '' ? (
              <Button small onClick={() => setClassQuery('')}>
                Clear search
              </Button>
            ) : (
              <Button small onClick={onClearProgram}>
                Show all programmes
              </Button>
            )}
          </EmptyState>
        )}

        {!loading && shownClasses.length > 0 && (
          <div className="class-grid">
            {shownClasses.map((k) => (
          <ClassDrop
            key={k.id}
            klass={k}
            seats={countOf.get(k.id) ?? 0}
            selected={selected}
            programName={programOf.get(k.id)?.name ?? ''}
            alreadyIn={selected.filter((c) => classesOf.get(c.studentId)?.has(k.id)).length}
            busy={busyClass === k.id}
            disabled={busyClass !== null}
            dragOver={dragOver === k.id}
            onDragOver={setDragOver}
            onEnroll={enroll}
            onOpen={setOpenClass}
          />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Everything about one class, without leaving the board.
 *
 * The roster comes from the term's enrolments, already in memory -- opening a
 * class should not cost a request for something the board just read. Staffing
 * is the exception: nothing on this screen needed it until now, so it is
 * fetched when the panel opens and not before.
 */
function ClassDetails({
  klass,
  programName,
  roster,
  onRemove,
  onClose,
}: {
  klass: RawRecord;
  programName: string;
  roster: { enrollmentId: string; name: string }[];
  onRemove: (enrollmentId: string, name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [staff, setStaff] = useState<RawRecord[] | null>(null);
  // Attendance marks per enrolment. Removing an enrolment cascades to its
  // marks -- attendance.enrollment is on_delete: cascade -- so a student with
  // a register behind them cannot be removed here at all. That is a deletion
  // of the record that they attended, not an undo of a misplacement.
  const [marks, setMarks] = useState<Map<string, number> | null>(null);
  // Removing a student is not undoable, so it asks -- in place, on the row,
  // rather than behind a dialog stacked on the panel that opened it.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [staffError, setStaffError] = useState<string | null>(null);
  const showStaffSpinner = useDelayed(staff === null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getAllocationsForClass(klass.id), getAttendanceCountsForClass(klass.id)])
      .then(([allocations, counts]) => {
        if (cancelled) return;
        setStaff(allocations.filter((a) => str(a[AL.status]) !== 'Ended'));
        setMarks(counts);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStaffError(describeError(err));
        setStaff([]);
        // An empty map would read as "no marks anywhere", which would unlock
        // every remove button on a failed read. Left null, so they stay shut.
        setMarks(null);
      });
    return () => { cancelled = true; };
  }, [klass.id]);

  const capacity = int(klass[C.capacity]);
  const days = strList(klass[C.meeting_days]);
  const time = [str(klass[C.start_time]), str(klass[C.end_time])].filter(Boolean).join('–');
  const status = classTone(str(klass[C.status]));

  return (
    <Drawer
      title={str(klass[C.name])}
      subtitle={
        <>
          {str(klass[C.class_code], '—')}
          {programName && <> · {programName}</>}
        </>
      }
      onClose={onClose}
    >
      <dl className="facts">
        <dt>Course</dt>
        <dd>{refName(klass[C.course]) || '—'}</dd>

        <dt>Term</dt>
        <dd>{refName(klass[C.term]) || '—'}</dd>

        <dt>Meets</dt>
        <dd>
          {days.length > 0 ? shortDays(days) : 'No days set'}
          {time && <> · {time}</>}
          {shiftOf(str(klass[C.start_time])) && (
            <> · {shiftOf(str(klass[C.start_time]))}</>
          )}
        </dd>

        <dt>Room</dt>
        <dd>{str(klass[C.room], '—')}</dd>

        <dt>Runs</dt>
        <dd>
          {str(klass[C.start_date], '—')} → {str(klass[C.end_date], '—')}
        </dd>

        <dt>Seats</dt>
        <dd>
          {roster.length}
          {capacity !== null && <span className="muted"> of {capacity}</span>}
        </dd>

        <dt>Status</dt>
        <dd>
          <Badge tone={status.tone} dot>{status.label}</Badge>
        </dd>
      </dl>

      <section className="drawer-section">
        <h3>Teachers</h3>
        {staffError && <Banner tone="error">{staffError}</Banner>}
        {staff === null
          ? showStaffSpinner && <Loader inline label="Loading staffing…" />
          : staff.length === 0
            ? <p className="muted">Nobody allocated to this class yet.</p>
            : (
              <ul className="roster">
                {staff.map((a) => (
                  <li key={a.id}>
                    <Avatar name={refName(a[AL.teacher])} small />
                    <span className="cell-lines">
                      <span className="cell-title">{refName(a[AL.teacher]) || '—'}</span>
                      <span className="cell-sub">{str(a[AL.role], '—')}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
      </section>

      <section className="drawer-section">
        <h3>Students ({roster.length})</h3>
        {roster.length === 0 ? (
          <p className="muted">Nobody enrolled yet.</p>
        ) : (
          <ul className="roster">
            {roster.map((r) => (
              <li key={r.enrollmentId}>
                <Avatar name={r.name} small />
                <span className="roster-name">{r.name}</span>

                {marks === null ? (
                  <span className="muted cell-sub">…</span>
                ) : (marks.get(r.enrollmentId) ?? 0) > 0 ? (
                  <span className="muted cell-sub" title="Removing would delete these marks">
                    {marks.get(r.enrollmentId)} mark
                    {marks.get(r.enrollmentId) === 1 ? '' : 's'}
                  </span>
                ) : confirming === r.enrollmentId ? (
                  <span className="roster-confirm">
                    <Button
                      small
                      variant="primary"
                      disabled={removing !== null}
                      onClick={async () => {
                        setRemoving(r.enrollmentId);
                        await onRemove(r.enrollmentId, r.name);
                        setRemoving(null);
                        setConfirming(null);
                      }}
                    >
                      {removing === r.enrollmentId ? 'Removing…' : 'Remove'}
                    </Button>
                    <Button small variant="ghost" onClick={() => setConfirming(null)}>
                      Cancel
                    </Button>
                  </span>
                ) : (
                  <Button
                    small
                    variant="ghost"
                    aria-label={`Remove ${r.name} from this class`}
                    onClick={() => setConfirming(r.enrollmentId)}
                  >
                    <Icon name="close" size={14} />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </Drawer>
  );
}

/**
 * One class, as a drop target.
 *
 * Also carries a button whenever a student is held, so the whole flow works
 * without a pointer: pick a student, tab here, press Enter. Drag-and-drop on
 * its own is unreachable by keyboard and silent to a screen reader.
 */
function ClassDrop({
  klass,
  seats,
  selected,
  programName,
  alreadyIn,
  busy,
  disabled,
  dragOver,
  onDragOver,
  onEnroll,
  onOpen,
}: {
  klass: RawRecord;
  seats: number;
  selected: Candidate[];
  /** The department this class's course belongs to; '' when it has none. */
  programName: string;
  /** How many of the selection are already in this class. */
  alreadyIn: number;
  busy: boolean;
  disabled: boolean;
  dragOver: boolean;
  onDragOver: (id: string | null) => void;
  onEnroll: (klass: RawRecord) => void;
  onOpen: (klass: RawRecord) => void;
}) {
  const capacity = int(klass[C.capacity]);
  const days = strList(klass[C.meeting_days]);
  const status = classTone(str(klass[C.status]));
  const full = capacity !== null && seats >= capacity;
  // A class accepts a drop whenever anything is selected: whoever cannot go
  // in -- already enrolled, no application -- is reported per student after
  // the attempt rather than blocking the whole set.
  const droppable = selected.length > 0 && !disabled;
  const placeable = selected.length - alreadyIn;
  const time = [str(klass[C.start_time]), str(klass[C.end_time])].filter(Boolean).join('–');
  const shift = shiftOf(str(klass[C.start_time]));

  return (
    <div
      className={[
        'drop-card',
        dragOver && droppable ? 'drop-over' : '',
        selected.length > 0 && placeable === 0 ? 'drop-blocked' : '',
      ].filter(Boolean).join(' ')}
      onDragOver={(e) => {
        if (!droppable) return;
        // Without preventDefault the browser refuses the drop outright.
        e.preventDefault();
        onDragOver(klass.id);
      }}
      onDragLeave={() => onDragOver(null)}
      onDrop={(e) => {
        e.preventDefault();
        onDragOver(null);
        if (droppable) onEnroll(klass);
      }}
    >
      {/* A real button, and outside the action row below -- buttons cannot
          nest, and the Enrol button lives there. */}
      <button type="button" className="drop-card-main" onClick={() => onOpen(klass)}>
        <Avatar name={str(klass[C.name])} />
        <div className="cell-lines">
          <div className="cell-title">{str(klass[C.name])}</div>
          <div className="cell-sub">
            {days.length > 0 ? shortDays(days) : 'No days set'}
            {time && <> · {time}</>}
            {str(klass[C.room]) && <> · {str(klass[C.room])}</>}
          </div>
          {programName && <div className="cell-sub faint">{programName}</div>}
        </div>
      </button>

      <div className="drop-card-side">
        {shift && <Chip>{shift}</Chip>}
        <Chip>
          <Icon name="users" size={13} />
          {capacity === null ? `${seats}` : `${seats} / ${capacity}`}
        </Chip>
        {full && <Badge tone="pending" dot>Full</Badge>}
        <Badge tone={status.tone} dot>{status.label}</Badge>
      </div>

      {/* Only while a student is held. A button on every class at all times
          would read as the card's primary action, which it is not. */}
      {selected.length > 0 && (
        <div className="drop-card-action">
          {placeable === 0 ? (
            <span className="muted cover-mark">
              <Icon name="check" size={14} />
              {selected.length === 1 ? 'Already in this class' : 'All already in this class'}
            </span>
          ) : (
            <Button
              variant={full ? 'default' : 'primary'}
              small
              disabled={disabled}
              onClick={() => onEnroll(klass)}
            >
              {busy
                ? 'Enrolling…'
                : selected.length === 1
                  ? `Enrol ${selected[0]?.name}${full ? ' anyway' : ''}`
                  : `Enrol ${placeable}${full ? ' anyway' : ''}`}
            </Button>
          )}
          {alreadyIn > 0 && placeable > 0 && (
            <span className="muted cell-sub">{alreadyIn} already in</span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Row pitch in the student list: the card plus the gap under it.
 *
 * Geometry lives here rather than in CSS because the windowing maths below
 * depends on it exactly -- a value that drifted from the stylesheet would put
 * rows slightly out of place and get worse the further you scrolled. The
 * stylesheet is told the height; it does not decide it.
 */
const ROW_H = 68;

/** How tall the list gets before it scrolls instead of growing the page. */
const LIST_MAX = 560;

/** Rows above and below the viewport, so a fast scroll does not show gaps. */
const OVERSCAN = 4;

/**
 * Renders only the rows you can see.
 *
 * A term of a thousand students is ~68,000px of column and a thousand card
 * subtrees, each with its own drag handlers. The list is a fixed pitch, so the
 * visible slice is arithmetic rather than measurement: an outer box of the
 * real total height keeps the scrollbar honest, and the handful of rows in
 * view are positioned into it.
 */
function StudentList({
  people,
  classesInView,
  selectedIds,
  disabled,
  onToggle,
}: {
  people: Candidate[];
  /** Classes each student holds within the current view; absent means none. */
  classesInView: Map<string, number>;
  selectedIds: Set<string>;
  disabled: boolean;
  onToggle: (who: Candidate) => void;
}) {
  const [scrollTop, setScrollTop] = useState(0);

  const height = Math.min(people.length * ROW_H, LIST_MAX);
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(people.length, first + Math.ceil(height / ROW_H) + OVERSCAN * 2);

  return (
    <div
      className="board-list"
      style={{ height }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div className="board-list-inner" style={{ height: people.length * ROW_H }}>
        {people.slice(first, last).map((c, i) => (
          <div key={c.studentId} className="board-row" style={{ top: (first + i) * ROW_H }}>
            <PersonCard
              person={c}
              classCount={classesInView.get(c.studentId) ?? 0}
              selected={selectedIds.has(c.studentId)}
              selectedCount={selectedIds.size}
              disabled={disabled}
              onToggle={onToggle}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * One student: draggable for a pointer, a toggle button for everything else.
 *
 * A card is not consumed by being placed -- a student takes several classes in
 * a term -- so the count of classes they are already in rides along, which is
 * also the fastest way to spot somebody who has been missed entirely.
 */
function PersonCard({
  person,
  classCount,
  selected,
  selectedCount,
  disabled,
  onToggle,
}: {
  person: Candidate;
  classCount: number;
  selected: boolean;
  /** Size of the whole selection, for the drag image. */
  selectedCount: number;
  disabled: boolean;
  onToggle: (who: Candidate) => void;
}) {
  return (
    <button
      type="button"
      className={`pick-card${selected ? ' is-picked' : ''}`}
      draggable={!disabled}
      aria-pressed={selected}
      disabled={disabled}
      onClick={() => onToggle(person)}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'copy';
        // Some browsers cancel a drag that carries no payload at all.
        e.dataTransfer.setData('text/plain', person.studentId);
        // Dragging means "this one too": an unselected card joins the
        // selection, a selected one takes the whole set with it.
        if (!selected) onToggle(person);

        // Say how many are coming. The browser's default drag image is the one
        // card under the pointer, so dragging a set of five looked exactly
        // like dragging one -- the other four appeared to be left behind.
        const count = selected ? selectedCount : selectedCount + 1;
        if (count > 1) {
          const ghost = document.createElement('div');
          ghost.className = 'drag-ghost';
          ghost.textContent = `${count} students`;
          document.body.appendChild(ghost);
          e.dataTransfer.setDragImage(ghost, 16, 16);
          // It has to be in the document when the image is taken, and gone
          // immediately after, or it sits on the page for the whole drag.
          window.setTimeout(() => ghost.remove(), 0);
        }
      }}
    >
      <span className="pick-check" aria-hidden="true">
        {selected && <Icon name="check" size={13} />}
      </span>
      <Avatar name={person.name} />
      <span className="cell-lines">
        <span className="cell-title">{person.name}</span>
        <span className="cell-sub">{person.detail}</span>
      </span>
      {classCount > 0 && (
        <span className="chip">
          {classCount} class{classCount === 1 ? '' : 'es'}
        </span>
      )}
    </button>
  );
}
