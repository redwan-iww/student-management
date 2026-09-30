import { useCallback, useEffect, useMemo, useState } from 'react';
import { GENDER_VALUES, ZOHO_MODULES } from '../generated/types';
import { ButtonBusy, Loader, useDelayed } from './Loader';
import { Avatar, Badge, Banner, Button, Chip, Drawer, EmptyState, Icon, Toast } from './ui';
import { classTone, shiftOf, shortDays } from './status';
import {
  createEnrollmentBatch,
  BULK_LIMIT,
  deleteEnrollment,
  describeError,
  getActiveStudents,
  getAllocationsForClass,
  attendanceRate,
  dropEnrollment,
  getAttendanceStatsForClass,
  getStudent,
  localDateTime,
  orgDateTime,
  getAdmissionsForTerm,
  getEnrollmentsForClass,
  getEnrollmentsForClasses,
  int,
  orgToday,
  refId,
  refName,
  str,
  strList,
  updateAdmission,
  updateStudent,
  type AttendanceStats,
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

/** One enrolment as the class drawer shows it. */
interface RosterRow {
  enrollmentId: string;
  studentId: string;
  name: string;
  /** Recorded at the end of the class; empty until then. */
  grade: string;
  /** Set only on the leavers. */
  droppedOn: string;
  dropReason: string;
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
  // Which student's record is open, if any. Held as id plus name so the panel
  // has something to title itself with while the record is still loading.
  const [openStudent, setOpenStudent] = useState<{ studentId: string; name: string } | null>(null);
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

  /**
   * The class's people, split by whether they are still in it.
   *
   * A dropped enrolment is not gone -- that is the whole point of dropping
   * rather than deleting -- so it is shown, separately, with its reason. The
   * seat counts elsewhere on the board keep counting Active only.
   */
  const openRoster = useMemo(() => {
    const empty = { active: [] as RosterRow[], dropped: [] as RosterRow[] };
    if (!openClass) return empty;
    const out = { active: [] as RosterRow[], dropped: [] as RosterRow[] };
    const seen = new Set<string>();
    for (const e of enrollments ?? []) {
      if (refId(e[E.class]) !== openClass.id) continue;
      const status = str(e[E.status]);
      const studentId = refId(e[E.student]);
      if (!studentId) continue;
      const row: RosterRow = {
        enrollmentId: e.id,
        studentId,
        name: refName(e[E.student]) || '—',
        grade: str(e[E.final_grade]),
        droppedOn: str(e[E.dropped_on]),
        dropReason: str(e[E.drop_reason]),
      };
      if (status === 'Active') {
        // One row per student: a duplicate pair would otherwise be counted
        // twice against the seats.
        if (seen.has(studentId)) continue;
        seen.add(studentId);
        out.active.push(row);
      } else if (status === 'Dropped' || status === 'Transferred') {
        out.dropped.push(row);
      }
    }
    const byName = (a: RosterRow, b: RosterRow) => a.name.localeCompare(b.name);
    out.active.sort(byName);
    out.dropped.sort(byName);
    return out;
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

  const dropStudent = useCallback(
    async (enrollmentId: string, name: string, reason: string) => {
      try {
        await dropEnrollment(enrollmentId, reason);
        // Patched in place rather than re-read, for the same reason the
        // removal filters locally: the term-wide reads lag a write, and every
        // seat count on this board derives from this list.
        setEnrollments((prev) =>
          (prev ?? []).map((e) =>
            e.id === enrollmentId
              ? {
                  ...e,
                  [E.status]: 'Dropped',
                  [E.dropped_on]: orgToday(),
                  [E.drop_reason]: reason,
                }
              : e,
          ),
        );
        setToast({ tone: 'positive', message: `${name} dropped from this class.` });
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

      {openStudent && (
        <StudentDetails
          studentId={openStudent.studentId}
          name={openStudent.name}
          /* The term's applications are already in memory. A student reached
             from the roll of all students may have no application for this
             term at all, which the panel says rather than hiding the section. */
          admission={
            (admissions ?? []).find((a) => refId(a[A.student]) === openStudent.studentId) ?? null
          }
          termLabel={termLabel}
          onAdmissionPatched={(id, patch) =>
            setAdmissions((prev) =>
              (prev ?? []).map((a) => (a.id === id ? { ...a, ...patch } : a)),
            )
          }
          onClose={() => setOpenStudent(null)}
        />
      )}

      {openClass && (
        <ClassDetails
          klass={openClass}
          programName={programOf.get(openClass.id)?.name ?? ''}
          roster={openRoster.active}
          dropped={openRoster.dropped}
          onRemove={removeEnrollment}
          onDrop={dropStudent}
          onOpenStudent={setOpenStudent}
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
              onOpenStudent={setOpenStudent}
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
  dropped,
  onRemove,
  onDrop,
  onOpenStudent,
  onClose,
}: {
  klass: RawRecord;
  programName: string;
  roster: RosterRow[];
  /** Enrolments that ended early. Shown, not hidden -- see openRoster. */
  dropped: RosterRow[];
  onRemove: (enrollmentId: string, name: string) => Promise<void>;
  onDrop: (enrollmentId: string, name: string, reason: string) => Promise<void>;
  onOpenStudent: (who: { studentId: string; name: string }) => void;
  onClose: () => void;
}) {
  const [staff, setStaff] = useState<RawRecord[] | null>(null);
  // Attendance per enrolment, serving two purposes at once. It is the guard on
  // deletion -- attendance.enrollment is on_delete: cascade, so deleting a row
  // with marks behind it destroys the register -- and it is the only source of
  // an attendance rate, because the schema's rollup field does not exist in
  // the CRM. One read, both answers.
  const [stats, setStats] = useState<Map<string, AttendanceStats> | null>(null);
  // Which row is mid-decision, and what is being done to it. Ending someone's
  // place in a class is not undoable, so it asks in place on the row.
  const [acting, setActing] = useState<{ id: string; mode: 'drop' | 'remove' } | null>(null);
  const [reason, setReason] = useState('');
  const [working, setWorking] = useState<string | null>(null);
  const [staffError, setStaffError] = useState<string | null>(null);
  const showStaffSpinner = useDelayed(staff === null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getAllocationsForClass(klass.id), getAttendanceStatsForClass(klass.id)])
      .then(([allocations, counts]) => {
        if (cancelled) return;
        setStaff(allocations.filter((a) => str(a[AL.status]) !== 'Ended'));
        setStats(counts);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStaffError(describeError(err));
        setStaff([]);
        // An empty map would read as "no marks anywhere", which would unlock
        // every delete button on a failed read. Left null, so they stay shut.
        setStats(null);
      });
    return () => { cancelled = true; };
  }, [klass.id]);

  const capacity = int(klass[C.capacity]);
  const sessions = int(klass[C.sessions_count]);
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

        <dt>Lessons</dt>
        <dd>
          {sessions === null ? (
            '—'
          ) : sessions === 0 ? (
            <span className="warn-text">
              <Icon name="alert" size={14} />
              None generated yet
            </span>
          ) : (
            <>{sessions} scheduled</>
          )}
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
            {roster.map((r) => {
              const st = stats?.get(r.enrollmentId);
              const marks = st?.marks ?? 0;
              const rate = attendanceRate(st);
              const mode = acting?.id === r.enrollmentId ? acting.mode : null;
              return (
                <li key={r.enrollmentId}>
                  <Avatar name={r.name} small />
                  <span className="cell-lines">
                    <button
                      type="button"
                      className="roster-name-btn"
                      onClick={() => onOpenStudent({ studentId: r.studentId, name: r.name })}
                    >
                      {r.name}
                    </button>
                    <span className="cell-sub">
                      {stats === null
                        ? '…'
                        : rate === null
                          ? 'No marks yet'
                          : `${rate}% attendance`}
                      {marks > 0 && <> · {marks} mark{marks === 1 ? '' : 's'}</>}
                      {r.grade && <> · Grade {r.grade}</>}
                    </span>
                  </span>

                  {mode === 'drop' ? (
                    <span className="roster-confirm roster-drop">
                      <input
                        type="text"
                        value={reason}
                        autoFocus
                        maxLength={2000}
                        placeholder="Why are they leaving?"
                        aria-label={`Reason ${r.name} is leaving this class`}
                        onChange={(e) => setReason(e.target.value)}
                      />
                      <Button
                        small
                        variant="primary"
                        disabled={working !== null || reason.trim() === ''}
                        onClick={async () => {
                          setWorking(r.enrollmentId);
                          await onDrop(r.enrollmentId, r.name, reason.trim());
                          setWorking(null);
                          setActing(null);
                          setReason('');
                        }}
                      >
                        {working === r.enrollmentId ? 'Dropping…' : 'Drop'}
                      </Button>
                      <Button
                        small
                        variant="ghost"
                        onClick={() => { setActing(null); setReason(''); }}
                      >
                        Cancel
                      </Button>
                    </span>
                  ) : mode === 'remove' ? (
                    <span className="roster-confirm">
                      <span className="muted cell-sub">Delete outright?</span>
                      <Button
                        small
                        variant="primary"
                        disabled={working !== null}
                        onClick={async () => {
                          setWorking(r.enrollmentId);
                          await onRemove(r.enrollmentId, r.name);
                          setWorking(null);
                          setActing(null);
                        }}
                      >
                        {working === r.enrollmentId ? 'Removing…' : 'Remove'}
                      </Button>
                      <Button small variant="ghost" onClick={() => setActing(null)}>
                        Cancel
                      </Button>
                    </span>
                  ) : (
                    <span className="roster-actions">
                      <Button
                        small
                        variant="ghost"
                        onClick={() => { setActing({ id: r.enrollmentId, mode: 'drop' }); setReason(''); }}
                      >
                        Drop
                      </Button>
                      {/* Deleting cascades to the register, so it is offered
                          only where there is none to lose -- a placement made
                          by mistake. Everyone else leaves by being dropped. */}
                      {stats !== null && marks === 0 && (
                        <Button
                          small
                          variant="ghost"
                          aria-label={`Delete ${r.name}'s enrolment`}
                          title="Delete this enrolment outright"
                          onClick={() => setActing({ id: r.enrollmentId, mode: 'remove' })}
                        >
                          <Icon name="close" size={14} />
                        </Button>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {dropped.length > 0 && (
        <section className="drawer-section">
          <h3>Left this class ({dropped.length})</h3>
          <ul className="roster">
            {dropped.map((r) => (
              <li key={r.enrollmentId} className="roster-past">
                <Avatar name={r.name} small />
                <span className="cell-lines">
                  <button
                    type="button"
                    className="roster-name-btn"
                    onClick={() => onOpenStudent({ studentId: r.studentId, name: r.name })}
                  >
                    {r.name}
                  </button>
                  <span className="cell-sub">
                    {r.droppedOn || 'date not recorded'}
                    {r.dropReason && <> · {r.dropReason}</>}
                  </span>
                </span>
                <Badge tone="neutral">Dropped</Badge>
              </li>
            ))}
          </ul>
        </section>
      )}
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
  // A class with no lessons generated cannot have a register taken against
  // it, so students placed here have nowhere to be marked present. Worth
  // seeing before the placement, not after.
  const sessions = int(klass[C.sessions_count]);
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
        {sessions !== null && sessions > 0 && (
          <Chip title={`${sessions} lessons scheduled`}>
            <Icon name="calendar" size={13} />
            {sessions}
          </Chip>
        )}
        {sessions === 0 && <Badge tone="critical" dot>No lessons</Badge>}
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
  onOpenStudent,
}: {
  people: Candidate[];
  /** Classes each student holds within the current view; absent means none. */
  classesInView: Map<string, number>;
  selectedIds: Set<string>;
  disabled: boolean;
  onToggle: (who: Candidate) => void;
  onOpenStudent: (who: { studentId: string; name: string }) => void;
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
              onOpenStudent={onOpenStudent}
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
  onOpenStudent,
}: {
  person: Candidate;
  classCount: number;
  selected: boolean;
  /** Size of the whole selection, for the drag image. */
  selectedCount: number;
  disabled: boolean;
  onToggle: (who: Candidate) => void;
  onOpenStudent: (who: { studentId: string; name: string }) => void;
}) {
  return (
    <div className={`pick-row${selected ? ' is-picked' : ''}`}>
    <button
      type="button"
      className="pick-card"
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

    <button
      type="button"
      className="pick-info"
      aria-label={`Open ${person.name}'s record`}
      title="Open record"
      onClick={() => onOpenStudent(person)}
    >
      <Icon name="info" size={15} />
    </button>
    </div>
  );
}

/**
 * Everything on file about one person, from both sides of their arrival, and
 * editable in place.
 *
 * Two records, deliberately shown together. The student row is who they are
 * now -- contacts, household, medical notes; the application is how they got
 * here -- source, stage, the dates it moved through. The board had neither:
 * it showed a name, an application number and a stage, and nothing else about
 * the person being placed into a class.
 *
 * Only the student record is fetched. The term's applications are already in
 * memory on the board, so the one that matches is handed down rather than
 * read again -- and a student reached from the roll of all students may have
 * no application for this term at all, which the panel says plainly.
 *
 * What editing deliberately leaves alone:
 *
 *   Student_Code, Application_No   autonumbers -- the server assigns them
 *   Active classes                 a rollup, counted from the enrolments
 *   Household                      a lookup; changing it needs a picker, not
 *                                  a text box, and moves the child's billing
 *   Status, Stage, Source          pipeline decisions. Stage especially:
 *                                  moving it is what puts somebody in or out
 *                                  of this board's own left-hand list, and a
 *                                  rejection wants a reason and a decided-by
 *                                  that this panel does not collect.
 */
function StudentDetails({
  studentId,
  name,
  admission,
  termLabel,
  onAdmissionPatched,
  onClose,
}: {
  studentId: string;
  name: string;
  admission: RawRecord | null;
  termLabel: string;
  /** Keeps the board's copy of the application in step with an edit here. */
  onAdmissionPatched: (admissionId: string, patch: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [student, setStudent] = useState<RawRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const showSpinner = useDelayed(student === null && error === null);

  // The application arrives as a prop but is edited here, so the panel keeps
  // its own copy and hands patches back up rather than writing through a prop.
  const [appRec, setAppRec] = useState<RawRecord | null>(admission);
  useEffect(() => { setAppRec(admission); }, [admission]);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>(BLANK_FORM);
  // What the fields held when editing began, so only what actually changed is
  // sent. A payload of unchanged values would stamp Modified_By across the
  // whole record for nothing.
  const [initial, setInitial] = useState<FormState>(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getStudent(studentId)
      .then((rec) => {
        if (cancelled) return;
        if (!rec) setError('That student record could not be read.');
        else setStudent(rec);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(describeError(err));
      });
    return () => { cancelled = true; };
  }, [studentId]);

  // Record_Image is a stock Zoho field and comes back as a URL when one has
  // been uploaded. Anything else -- null, or the object shape some versions
  // return -- falls back to the initials avatar rather than a broken image.
  const photo = student ? str(student[ST.photo]) : '';
  const hasPhoto = /^https?:\/\//.test(photo);

  const set = (key: keyof FormState) => (
    e: { target: { value: string } },
  ) => setForm((f) => ({ ...f, [key]: e.target.value }));

  function startEditing() {
    const next = formOf(student, appRec);
    setForm(next);
    setInitial(next);
    setSaveError(null);
    setEditing(true);
  }

  async function save() {
    if (!student) return;
    setSaving(true);
    setSaveError(null);

    const sp: Record<string, unknown> = {};
    const put = (changed: boolean, field: string, value: unknown) => {
      if (changed) sp[field] = value;
    };
    put(form.dob !== initial.dob, ST.date_of_birth, form.dob || null);
    put(form.gender !== initial.gender, ST.gender, form.gender || null);
    put(form.phone !== initial.phone, ST.phone, form.phone.trim() || null);
    put(form.email !== initial.email, ST.email, form.email.trim() || null);
    put(form.emName !== initial.emName, ST.emergency_contact_name, form.emName.trim() || null);
    put(form.emPhone !== initial.emPhone, ST.emergency_contact_phone, form.emPhone.trim() || null);
    put(form.medical !== initial.medical, ST.medical_notes, form.medical.trim() || null);

    const ap: Record<string, unknown> = {};
    if (appRec) {
      if (form.gName !== initial.gName) ap[A.guardian_name] = form.gName.trim() || null;
      if (form.gPhone !== initial.gPhone) ap[A.guardian_phone] = form.gPhone.trim() || null;
      if (form.gEmail !== initial.gEmail) ap[A.guardian_email] = form.gEmail.trim() || null;
      if (form.decision !== initial.decision) ap[A.decision_date] = form.decision || null;
      if (form.notes !== initial.notes) ap[A.notes] = form.notes.trim() || null;
      if (form.interview !== initial.interview) {
        // Datetime, so it needs the org's offset -- never a bare local string
        // and never a trailing Z.
        ap[A.interview_date] = form.interview ? orgDateTime(form.interview) : null;
      }
    }

    // Two records, two writes. The student goes first, and its result is kept
    // whatever happens next -- a half-saved edit is reported as such rather
    // than rolled back silently or claimed as a success.
    if (Object.keys(sp).length > 0) {
      try {
        await updateStudent(studentId, sp);
        setStudent((prev) => (prev ? { ...prev, ...sp } : prev));
      } catch (err) {
        setSaveError(`Nothing was saved: ${describeError(err)}`);
        setSaving(false);
        return;
      }
    }

    if (appRec && Object.keys(ap).length > 0) {
      try {
        await updateAdmission(appRec.id, ap);
        setAppRec((prev) => (prev ? { ...prev, ...ap } : prev));
        onAdmissionPatched(appRec.id, ap);
      } catch (err) {
        setSaveError(
          Object.keys(sp).length > 0
            ? `The student details were saved, but the application was not: ${describeError(err)}`
            : `The application was not saved: ${describeError(err)}`,
        );
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    setEditing(false);
  }

  return (
    <Drawer
      title={name}
      subtitle={student ? str(student[ST.student_code], '—') : 'Loading…'}
      onClose={onClose}
      footer={
        student && (
          <>
            {saveError && <Banner tone="error">{saveError}</Banner>}
            <div className="drawer-actions">
              {editing ? (
                <>
                  <Button variant="primary" onClick={save} disabled={saving}>
                    {saving ? <ButtonBusy label="Saving…" /> : 'Save changes'}
                  </Button>
                  <Button variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button onClick={startEditing}>Edit details</Button>
              )}
            </div>
          </>
        )
      }
    >
      {error && <Banner tone="error">{error}</Banner>}
      {student === null && !error && showSpinner && <Loader inline label="Loading record…" />}

      {student && (
        <>
          <div className="student-head">
            {hasPhoto ? (
              <img className="student-photo" src={photo} alt="" />
            ) : (
              <Avatar name={name} />
            )}
            <div className="cell-lines">
              <div className="cell-title">{str(student[ST.full_name], name)}</div>
              <div className="cell-sub">
                {refName(student[ST.household]) || 'No household on file'}
              </div>
            </div>
            <Badge tone={str(student[ST.status]) === 'Active' ? 'positive' : 'neutral'} dot>
              {str(student[ST.status], '—')}
            </Badge>
          </div>

          <dl className="facts">
            <dt>Date of birth</dt>
            <dd>
              {editing ? (
                <input className="field" type="date" value={form.dob} onChange={set('dob')} />
              ) : (
                <>
                  {str(student[ST.date_of_birth], '—')}
                  {ageOf(str(student[ST.date_of_birth])) !== null && (
                    <span className="muted"> · {ageOf(str(student[ST.date_of_birth]))} years</span>
                  )}
                </>
              )}
            </dd>

            <dt>Gender</dt>
            <dd>
              {editing ? (
                <select className="field" value={form.gender} onChange={set('gender')}>
                  <option value="">—</option>
                  {GENDER_VALUES.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              ) : (
                str(student[ST.gender], '—')
              )}
            </dd>

            <dt>Phone</dt>
            <dd>
              {editing ? (
                <input className="field" type="tel" value={form.phone} onChange={set('phone')} />
              ) : (
                str(student[ST.phone], '—')
              )}
            </dd>

            <dt>Email</dt>
            <dd>
              {editing ? (
                <input className="field" type="email" value={form.email} onChange={set('email')} />
              ) : (
                str(student[ST.email], '—')
              )}
            </dd>

            <dt>On roll since</dt>
            <dd>{str(student[ST.enrollment_date], '—')}</dd>

            <dt>Active classes</dt>
            <dd>{int(student[ST.active_enrollments_count]) ?? 0}</dd>
          </dl>

          <section className="drawer-section">
            <h3>In an emergency</h3>
            {editing ? (
              <dl className="facts">
                <dt>Name</dt>
                <dd>
                  <input className="field" value={form.emName} onChange={set('emName')} />
                </dd>
                <dt>Phone</dt>
                <dd>
                  <input className="field" type="tel" value={form.emPhone} onChange={set('emPhone')} />
                </dd>
              </dl>
            ) : str(student[ST.emergency_contact_name]) ||
              str(student[ST.emergency_contact_phone]) ? (
              <p>
                <strong>{str(student[ST.emergency_contact_name], '—')}</strong>
                {str(student[ST.emergency_contact_phone]) && (
                  <> · {str(student[ST.emergency_contact_phone])}</>
                )}
              </p>
            ) : (
              <p className="muted">No emergency contact on file.</p>
            )}
          </section>

          {/* Called out rather than left as one row in the table above: if
              there is anything here, whoever is about to put this student in
              a class needs to have seen it. */}
          <section className="drawer-section">
            <h3>Medical notes</h3>
            {editing ? (
              <textarea
                className="field"
                rows={3}
                maxLength={2000}
                placeholder="Allergies, medication, anything a teacher must know"
                value={form.medical}
                onChange={set('medical')}
              />
            ) : str(student[ST.medical_notes]) ? (
              <Banner tone="warn">{str(student[ST.medical_notes])}</Banner>
            ) : (
              <p className="muted">None recorded.</p>
            )}
          </section>

          <section className="drawer-section">
            <h3>Application</h3>
            {appRec === null ? (
              <p className="muted">
                No application for {termLabel}. This student is on the roll from an
                earlier term.
              </p>
            ) : (
              <dl className="facts">
                <dt>Application</dt>
                <dd>{str(appRec[A.application_no], '—')}</dd>

                <dt>Stage</dt>
                <dd>{str(appRec[A.stage], '—')}</dd>

                <dt>Came from</dt>
                <dd>{str(appRec[A.source], '—')}</dd>

                <dt>Applied</dt>
                <dd>{str(appRec[A.applied_date], '—')}</dd>

                <dt>Interview</dt>
                <dd>
                  {editing ? (
                    <input
                      className="field"
                      type="datetime-local"
                      value={form.interview}
                      onChange={set('interview')}
                    />
                  ) : (
                    str(appRec[A.interview_date], 'Not scheduled')
                  )}
                </dd>

                <dt>Decided</dt>
                <dd>
                  {editing ? (
                    <input
                      className="field"
                      type="date"
                      value={form.decision}
                      onChange={set('decision')}
                    />
                  ) : (
                    str(appRec[A.decision_date], 'Not recorded')
                  )}
                </dd>

                <dt>Guardian</dt>
                <dd>
                  {editing ? (
                    <div className="field-stack">
                      <input
                        className="field"
                        value={form.gName}
                        placeholder="Name"
                        aria-label="Guardian name"
                        onChange={set('gName')}
                      />
                      <input
                        className="field"
                        type="tel"
                        value={form.gPhone}
                        placeholder="Phone"
                        aria-label="Guardian phone"
                        onChange={set('gPhone')}
                      />
                      <input
                        className="field"
                        type="email"
                        value={form.gEmail}
                        placeholder="Email"
                        aria-label="Guardian email"
                        onChange={set('gEmail')}
                      />
                    </div>
                  ) : (
                    <>
                      {str(appRec[A.guardian_name], '—')}
                      {str(appRec[A.guardian_phone]) && <> · {str(appRec[A.guardian_phone])}</>}
                      {str(appRec[A.guardian_email]) && (
                        <span className="muted"> · {str(appRec[A.guardian_email])}</span>
                      )}
                    </>
                  )}
                </dd>

                <dt>Notes</dt>
                <dd>
                  {editing ? (
                    <textarea
                      className="field"
                      rows={3}
                      maxLength={2000}
                      value={form.notes}
                      onChange={set('notes')}
                    />
                  ) : str(appRec[A.notes]) ? (
                    <span className="note-inline">{str(appRec[A.notes])}</span>
                  ) : (
                    '—'
                  )}
                </dd>
              </dl>
            )}
          </section>
        </>
      )}
    </Drawer>
  );
}

/** The editable half of the panel, as strings an input can hold. */
interface FormState {
  dob: string;
  gender: string;
  phone: string;
  email: string;
  emName: string;
  emPhone: string;
  medical: string;
  gName: string;
  gPhone: string;
  gEmail: string;
  interview: string;
  decision: string;
  notes: string;
}

const BLANK_FORM: FormState = {
  dob: '', gender: '', phone: '', email: '', emName: '', emPhone: '', medical: '',
  gName: '', gPhone: '', gEmail: '', interview: '', decision: '', notes: '',
};

function formOf(student: RawRecord | null, admission: RawRecord | null): FormState {
  return {
    dob: student ? str(student[ST.date_of_birth]) : '',
    gender: student ? str(student[ST.gender]) : '',
    phone: student ? str(student[ST.phone]) : '',
    email: student ? str(student[ST.email]) : '',
    emName: student ? str(student[ST.emergency_contact_name]) : '',
    emPhone: student ? str(student[ST.emergency_contact_phone]) : '',
    medical: student ? str(student[ST.medical_notes]) : '',
    gName: admission ? str(admission[A.guardian_name]) : '',
    gPhone: admission ? str(admission[A.guardian_phone]) : '',
    gEmail: admission ? str(admission[A.guardian_email]) : '',
    interview: admission ? localDateTime(admission[A.interview_date]) : '',
    decision: admission ? str(admission[A.decision_date]) : '',
    notes: admission ? str(admission[A.notes]) : '',
  };
}

/** Whole years between a yyyy-MM-dd birth date and today, or null if unparsable. */
function ageOf(isoDate: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const today = orgToday();
  let years = Number(today.slice(0, 4)) - Number(isoDate.slice(0, 4));
  // Not had the birthday yet this year.
  if (today.slice(5) < isoDate.slice(5)) years -= 1;
  return years >= 0 && years < 150 ? years : null;
}
