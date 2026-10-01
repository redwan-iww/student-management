import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  BILLING_STATUS_VALUES,
  CONTACT_METHOD_VALUES,
  GENDER_VALUES,
  GUARDIAN_RELATIONSHIP_VALUES,
  ZOHO_MODULES,
} from '../generated/types';
import { Loader, useDelayed } from './Loader';
import { Avatar, Badge, Banner, Button, Chip, Drawer, EmptyState, Icon, Toast } from './ui';
import { classTone, programLabel, shiftOf, shortDays } from './status';
import {
  createEnrollmentBatch,
  BULK_LIMIT,
  deleteEnrollment,
  describeError,
  getActiveStudents,
  getAllocationsForClass,
  attendanceRate,
  dropEnrollment,
  getAttendanceForStudent,
  getAttendanceStatsForClass,
  getClassesByIds,
  getEnrollmentsForStudent,
  getHousehold,
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
  updateHousehold,
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
const H = ZOHO_MODULES.households.fields;
const AT = ZOHO_MODULES.attendance.fields;

/**
 * Whether an enrolment means the student is, or was, in that class.
 *
 * Active and Completed both do. A finished term's enrolments are Completed --
 * the seat was taken, the register was kept, a grade came out of it -- so a
 * class that ran to the end is not an empty class. Dropped and Transferred do
 * not: that is the whole point of dropping rather than deleting. Pending is
 * not a placement yet.
 *
 * Seats, the per-student class count and the drawer's roster all read this,
 * so they cannot disagree. They used to: seats counted Active alone while the
 * student's chip counted every status, so a completed term showed "0 / 18" on
 * the class beside a student card reading "3 classes".
 */
function holdsPlace(status: string): boolean {
  return status === 'Active' || status === 'Completed';
}

/** Where the right-hand column gets its people from. */
export type Source = 'admitted' | 'active';

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
 * One open panel. The board keeps these in a stack so that closing the panel
 * on top uncovers the one it was opened from.
 *
 * A student is held as id plus name, not as the record: the name is what the
 * panel titles itself with while it is still fetching, and the roster row it
 * was opened from already has it.
 */
type DrawerEntry =
  | { kind: 'class'; klass: RawRecord }
  | { kind: 'student'; studentId: string; name: string };

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
  programCount,
  programId,
  onClearProgram,
  offeringsOf,
  source,
  onSourceChange,
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
  programOf: Map<string, { id: string; name: string }[]>;
  /** How many programmes the term has at all. A class offered by every one of
   *  them is labelled as such rather than listed -- see `programLabel`. */
  programCount: number;
  /** The department chosen in the toolbar. Empty means all of them. */
  programId: string;
  /** Clears that choice. The picker lives in the toolbar, so this is the only
   *  way a panel down here can offer a way out of a filter that emptied it. */
  onClearProgram: () => void;
  /** Course id -> the programmes offering it. The student panel checks a
   *  placement against the student's own programme with this. */
  offeringsOf: Map<string, { id: string; name: string }[]>;
  /** Which roll to offer. Owned by the page -- its control sits up in the
   *  toolbar with the term and programme pickers, which are the same kind of
   *  question: which slice of the school am I looking at. */
  source: Source;
  onSourceChange: (next: Source) => void;
}) {
  const termId = term.id;
  const termLabel = str(term[T.name], 'this term');
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
  // The drawers that are open, oldest first -- a class opened from the board,
  // a student opened from that class's roll, a class of theirs opened from the
  // student's record, and so on. Closing one returns to the one behind it
  // instead of back to the board, so following a name does not lose the place
  // it was followed from.
  //
  // Only the top of the stack is rendered. Two full-height panels at the same
  // size sit exactly on top of each other, so the one underneath would not be
  // visible anyway, while a second scrim would darken the page twice and a
  // second aria-modal would leave two dialogs claiming the screen reader.
  const [drawers, setDrawers] = useState<DrawerEntry[]>([]);
  const pushDrawer = useCallback((d: DrawerEntry) => setDrawers((s) => [...s, d]), []);
  const popDrawer = useCallback(() => setDrawers((s) => s.slice(0, -1)), []);
  const openDrawer: DrawerEntry | null = drawers[drawers.length - 1] ?? null;
  // The class whose roster the board must have ready, which is only ever the
  // one on top: a class further down the stack is not on screen to need it.
  const openClass = openDrawer !== null && openDrawer.kind === 'class' ? openDrawer.klass : null;
  const [busyClass, setBusyClass] = useState<string | null>(null);
  // What just happened. The Toast is itself the live region, so this is the
  // one channel -- sighted and otherwise -- rather than a visible message and
  // a separate hidden announcement that have to be kept in step.
  const [toast, setToast] = useState<{ tone: 'positive' | 'warn'; message: string } | null>(null);
  // Picking a student up and putting them down needs announcing, but does not
  // deserve a toast: it is a state the page already shows.
  const [announcement, setAnnouncement] = useState('');

  // Student id by student, so the Applied list can show it even though an
  // application record does not carry one.
  const refOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of students ?? []) {
      const ref = str(r[ST.student_ref]);
      if (ref) m.set(r.id, ref);
    }
    return m;
  }, [students]);

  // Derived, not fetched. Switching source is instant: both lists are built
  // from reads that have already happened.
  const candidates = useMemo((): Candidate[] | null => {
    if (source === 'admitted') {
      if (admissions === null) return null;
      return admissions
        .map((r): Candidate => ({
          studentId: refId(r[A.student]) ?? '',
          name: refName(r[A.student]),
          detail: [
            // The id already ends in the application's serial -- ENG-2026T3-057
            // is APP-57 -- so showing both would say the same thing twice.
            refOf.get(refId(r[A.student]) ?? '') || str(r[A.application_no]),
            str(r[A.stage]),
          ].filter(Boolean).join(' · '),
          programId: refId(r[A.program]) ?? '',
        }))
        .filter((c) => c.studentId);
    }
    if (students === null) return null;
    return students.map((r): Candidate => ({
      studentId: r.id,
      name: str(r[ST.full_name], r.id),
      detail: str(r[ST.student_ref]) || str(r[ST.student_code], '—'),
      programId: '',
    }));
  }, [source, admissions, students, refOf]);

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

  // The roll, read once per mount whichever list is showing: an application
  // names the student but does not carry their id, so the Applied list needs
  // this too. It used to wait until somebody switched to All students; the
  // cost of reading it up front buys the id on every row and makes the switch
  // instant. It carries no term, so changing term is not a reason to re-read.
  useEffect(() => {
    if (students !== null) return;
    let cancelled = false;
    getActiveStudents()
      .then((recs) => { if (!cancelled) setStudents(recs); })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(describeError(err));
        setStudents([]);
      });
    return () => { cancelled = true; };
  }, [students]);

  // Which classes each student is already in, and how full each class is.
  // Both come off the one term-wide fetch rather than a query per class --
  // which is exactly what enrollments.term is denormalized for.
  const { classesOf, pairsOf, countOf } = useMemo(() => {
    // Classes the student actually holds -- what the chip and the seat counts
    // describe.
    const classesOf = new Map<string, Set<string>>();
    // Every (student, class) pair ever written, whatever became of it. A
    // dropped enrolment still occupies the pair that
    // uq_enrollment_student_class keeps unique, so re-enrolling would be a
    // duplicate even though the student is no longer in the class.
    const pairsOf = new Map<string, Set<string>>();
    const countOf = new Map<string, number>();
    const add = (m: Map<string, Set<string>>, k: string, v: string) => {
      let set = m.get(k);
      if (!set) m.set(k, (set = new Set()));
      set.add(v);
    };
    for (const e of enrollments ?? []) {
      const studentId = refId(e[E.student]);
      const classId = refId(e[E.class]);
      if (!studentId || !classId) continue;
      add(pairsOf, studentId, classId);
      if (holdsPlace(str(e[E.status]))) {
        countOf.set(classId, (countOf.get(classId) ?? 0) + 1);
        add(classesOf, studentId, classId);
      }
    }
    return { classesOf, pairsOf, countOf };
  }, [enrollments]);

  const shownClasses = useMemo(() => {
    const q = classQuery.trim().toLowerCase();
    return classes.filter((k) => {
      if (programId && !(programOf.get(k.id) ?? []).some((pr) => pr.id === programId)) {
        return false;
      }
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
        if (!programId || (programOf.get(classId) ?? []).some((pr) => pr.id === programId)) {
          n += 1;
        }
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
      if (holdsPlace(status)) {
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

  // Changing roll empties the selection: the people in it may not appear in
  // the list being switched to, and enrolling someone you can no longer see is
  // how a misplacement happens.
  useEffect(() => { setSelected([]); }, [source]);

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

      {openDrawer !== null && openDrawer.kind === 'student' && (
        <StudentDetails
          /* Keyed so that following one student from another's record remounts
             rather than reusing the panel -- without it the new id would land
             in a panel still showing the previous record's fetched state. */
          key={openDrawer.studentId}
          studentId={openDrawer.studentId}
          name={openDrawer.name}
          /* The term's applications are already in memory. A student reached
             from the roll of all students may have no application for this
             term at all, which the panel says rather than hiding the section. */
          admission={
            (admissions ?? []).find((a) => refId(a[A.student]) === openDrawer.studentId) ?? null
          }
          termLabel={termLabel}
          offeringsOf={offeringsOf}
          onOpenClass={(klass) => pushDrawer({ kind: 'class', klass })}
          onDropEnrolment={dropStudent}
          onAdmissionPatched={(id, patch) =>
            setAdmissions((prev) =>
              (prev ?? []).map((a) => (a.id === id ? { ...a, ...patch } : a)),
            )
          }
          onClose={popDrawer}
        />
      )}

      {openDrawer !== null && openDrawer.kind === 'class' && (
        <ClassDetails
          key={openDrawer.klass.id}
          klass={openDrawer.klass}
          programs={programOf.get(openDrawer.klass.id) ?? []}
          /* Null when the class is not in the term on screen: its roster is
             not in `enrollments` and the drawer must read its own. */
          roster={
            (classes ?? []).some((k) => k.id === openDrawer.klass.id) ? openRoster.active : null
          }
          dropped={openRoster.dropped}
          onRemove={removeEnrollment}
          onDrop={dropStudent}
          onOpenStudent={(who) => pushDrawer({ kind: 'student', ...who })}
          onClose={popDrawer}
        />
      )}


      <div className="board-col">
        {/* Heading, filter and action on one row: what the column holds, what
            narrows it, what acts on it. The standing instruction that used to
            sit under this is gone -- every row carries a tick box and the bar
            below counts the selection, so a sentence repeating that forever
            earned no space. */}
        <div className="board-head">
          <h2>
            Students{' '}
            <span className="count">
              {peopleNarrowed
                ? `${shownPeople.length} of ${candidates?.length ?? 0}`
                : (candidates?.length ?? 0)}
            </span>
          </h2>

          {!peopleLoading && placedCount > 0 && (
            <label className="board-toggle">
              <input
                type="checkbox"
                checked={hidePlaced}
                onChange={(e) => setHidePlaced(e.target.checked)}
              />
              Hide {placedCount} placed
            </label>
          )}

          {!peopleLoading && selected.length === 0 && shownPeople.length > 0 && (
            <Button
              small
              className="board-tools-end"
              onClick={() => setSelected(shownPeople)}
            >
              Select all {shownPeople.length}
            </Button>
          )}
        </div>

        {/* Shown while the roll is still loading, not just once it has arrived.
            The class list opposite is a prop and is already in hand, so its
            filter is there on the first paint; this one waited for a fetch and
            appeared afterwards, leaving the two columns mismatched and then
            shoving this one down. Typing before the people land is harmless --
            the query is applied to them when they do. */}
        {(peopleLoading || (candidates?.length ?? 0) > 8) && (
          <input
            type="text"
            className="board-search"
            value={studentQuery}
            placeholder="Find a student by name or code…"
            aria-label="Find a student"
            onChange={(e) => setStudentQuery(e.target.value)}
          />
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
              <Button small onClick={() => onSourceChange('active')}>
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
              onOpenStudent={(who) => pushDrawer({ kind: 'student', ...who })}
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
            program={programLabel(programOf.get(k.id) ?? [], programCount)}
            alreadyIn={selected.filter((c) => pairsOf.get(c.studentId)?.has(k.id)).length}
            busy={busyClass === k.id}
            disabled={busyClass !== null}
            dragOver={dragOver === k.id}
            onDragOver={setDragOver}
            onEnroll={enroll}
            onOpen={(klass) => pushDrawer({ kind: 'class', klass })}
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
  programs,
  roster,
  dropped,
  onRemove,
  onDrop,
  onOpenStudent,
  onClose,
}: {
  klass: RawRecord;
  /** Every programme offering this class's course. Listed in full below --
   *  this is the panel, so there is room the card does not have. */
  programs: { id: string; name: string }[];
  /**
   * The roster as the board already knows it, or null when this class is not
   * in the term on screen -- a class opened from a student's record can be
   * from any term, and the board only holds the current one. Null means fetch.
   */
  roster: RosterRow[] | null;
  /** Enrolments that ended early. Shown, not hidden -- see openRoster. */
  dropped: RosterRow[];
  onRemove: (enrollmentId: string, name: string) => Promise<void>;
  onDrop: (enrollmentId: string, name: string, reason: string) => Promise<void>;
  onOpenStudent: (who: { studentId: string; name: string }) => void;
  onClose: () => void;
}) {
  // Only used when `roster` is null: the class belongs to another term, so
  // its roster has to be read rather than derived from what is on screen.
  const [ownRoster, setOwnRoster] = useState<RosterRow[] | null>(null);

  useEffect(() => {
    if (roster !== null) { setOwnRoster(null); return; }
    let cancelled = false;
    getEnrollmentsForClass(klass.id, false)
      .then((recs) => {
        if (cancelled) return;
        setOwnRoster(
          recs
            .filter((e) => holdsPlace(str(e[E.status])))
            .map((e) => ({
              enrollmentId: e.id,
              studentId: refId(e[E.student]) ?? '',
              name: refName(e[E.student]) || '—',
              grade: str(e[E.final_grade]),
              droppedOn: '',
              dropReason: '',
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      })
      .catch(() => { if (!cancelled) setOwnRoster([]); });
    return () => { cancelled = true; };
  }, [roster, klass.id]);

  // What the panel below actually renders.
  const shown = roster ?? ownRoster ?? [];

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
        </>
      }
      onClose={onClose}
    >
      <dl className="facts">
        <dt>Course</dt>
        <dd>{refName(klass[C.course]) || '—'}</dd>

        {/* In full here. The card outside only has room for a summary, so this
            is the one place the whole list is readable without a tooltip. */}
        <dt>Programme</dt>
        <dd>{programs.length > 0 ? programs.map((pr) => pr.name).join(', ') : '—'}</dd>

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
          {shown.length}
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
        <h3>Students ({shown.length})</h3>
        {shown.length === 0 ? (
          <p className="muted">Nobody enrolled yet.</p>
        ) : (
          <ul className="roster">
            {shown.map((r) => {
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
                      <span className="muted cell-sub">Erase this enrolment?</span>
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
                      {/* Two different things, so both say which. An icon for
                          the second one made it look like a close button and
                          told you nothing about how it differs from Drop. */}
                      <Button
                        small
                        variant="ghost"
                        title={`${r.name} left the class — keeps the enrolment, the register and the reason`}
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
                          className="roster-delete"
                          title="Put here by mistake — erases the enrolment entirely"
                          onClick={() => setActing({ id: r.enrollmentId, mode: 'remove' })}
                        >
                          Delete
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
  program,
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
  /** The programmes offering it, already summarised for one line by
   *  `programLabel`, with the full list in `title`. Null when it has none. */
  program: { text: string; title: string } | null;
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
          {program && (
            <div className="cell-sub faint" title={program.title}>
              {program.text}
            </div>
          )}
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

/**
 * The height assumed before the list has been measured.
 *
 * It no longer caps anything: the column stretches to match the class grid
 * beside it, so the real height is measured. This is only what the first
 * render slices with, and a wrong guess costs one extra frame of rows.
 */
const LIST_FALLBACK = 560;

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
  const box = useRef<HTMLDivElement>(null);
  // The column stretches to whatever the class grid next to it needs, and that
  // changes with the programme filter, the search and the window width. So the
  // visible slice is computed from a measured height rather than a constant --
  // a fixed one left the list short beside a tall grid, scrolling inside a
  // column that had room to spare.
  const [viewport, setViewport] = useState(LIST_FALLBACK);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    setViewport(el.clientHeight);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setViewport(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(people.length, first + Math.ceil(viewport / ROW_H) + OVERSCAN * 2);

  return (
    <div
      className="board-list"
      ref={box}
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
 * Everything on file about one person, from both sides of their arrival.
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
 * Editing is per field, not per panel. One pencil, one value, one write: a
 * correction to a phone number never has to travel with whatever else was on
 * screen, nothing is staged waiting for a Save at the bottom, and a failure
 * belongs to the row that caused it instead of being reported for the record
 * as a whole.
 *
 * What stays read-only:
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
  offeringsOf,
  onOpenClass,
  onDropEnrolment,
  onAdmissionPatched,
  onClose,
}: {
  studentId: string;
  name: string;
  admission: RawRecord | null;
  termLabel: string;
  offeringsOf: Map<string, { id: string; name: string }[]>;
  /** Opens a class from one of this student's rows. The board owns the class
   *  drawer, and the two panels cannot stack, so this closes the student. */
  onOpenClass: (klass: RawRecord) => void;
  /** Ends one of this student's placements. The board owns the write so its
   *  seat counts stay in step; the panel patches its own copy on success. */
  onDropEnrolment: (enrollmentId: string, name: string, reason: string) => Promise<void>;
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

  // The family record, reached through the student's lookup. A second request
  // on purpose: the lookup carries only an id and a name, and the contact
  // details that make this section worth having are not reachable from it.
  const [house, setHouse] = useState<RawRecord | null>(null);
  const [houseError, setHouseError] = useState<string | null>(null);
  const householdId = student ? refId(student[ST.household]) : null;

  useEffect(() => {
    if (!householdId) { setHouse(null); return; }
    let cancelled = false;
    setHouseError(null);
    getHousehold(householdId)
      .then((rec) => {
        if (cancelled) return;
        // A lookup whose target has been deleted still resolves to an id, so
        // a missing record here is a dangling link rather than an error.
        if (!rec) setHouseError('This household record no longer exists.');
        else setHouse(rec);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setHouseError(describeError(err));
      });
    return () => { cancelled = true; };
  }, [householdId]);

  // What this student has taken, across every term -- not just the one the
  // board happens to be showing.
  const [taken, setTaken] = useState<RawRecord[] | null>(null);
  const [takenError, setTakenError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTaken(null);
    setTakenError(null);
    getEnrollmentsForStudent(studentId)
      .then((rows) => { if (!cancelled) setTaken(rows); })
      .catch((err: unknown) => { if (!cancelled) setTakenError(describeError(err)); });
    return () => { cancelled = true; };
  }, [studentId]);

  // The classes behind those enrolments -- an enrolment names its class but
  // carries none of its detail, and the board only holds the *current* term's
  // classes, so a student's earlier terms would have nothing to show.
  const [klasses, setKlasses] = useState<Map<string, RawRecord>>(new Map());
  // Every mark this student has, across every class. attendance.student is
  // denormalized for exactly this: one read instead of one per class.
  const [marks, setMarks] = useState<RawRecord[] | null>(null);

  useEffect(() => {
    const ids = (taken ?? []).map((e) => refId(e[E.class]) ?? '').filter(Boolean);
    if (ids.length === 0) return;
    let cancelled = false;
    getClassesByIds(ids)
      .then((m) => { if (!cancelled) setKlasses(m); })
      .catch(() => { /* a class that will not load blanks its own detail */ });
    return () => { cancelled = true; };
  }, [taken]);

  useEffect(() => {
    let cancelled = false;
    setMarks(null);
    getAttendanceForStudent(studentId)
      .then((rows) => { if (!cancelled) setMarks(rows); })
      // Attendance is a nice-to-have on this panel; failing to read it must
      // not take the record down with it.
      .catch(() => { if (!cancelled) setMarks([]); });
    return () => { cancelled = true; };
  }, [studentId]);

  // Attendance per enrolment, to the same rule as the class drawer: Present or
  // Late over everything that is not Excused.
  const tallyOf = useMemo(() => {
    const tally = new Map<string, { present: number; eligible: number }>();
    for (const m of marks ?? []) {
      const id = refId(m[AT.enrollment]);
      if (!id) continue;
      const row = tally.get(id) ?? { present: 0, eligible: 0 };
      const st = str(m[AT.status]);
      if (st !== 'Excused') row.eligible += 1;
      if (st === 'Present' || st === 'Late') row.present += 1;
      tally.set(id, row);
    }
    return tally;
  }, [marks]);

  const rateOf = useMemo(() => {
    const out = new Map<string, number | null>();
    for (const [id, t] of tallyOf) {
      out.set(id, t.eligible === 0 ? null : Math.round((t.present / t.eligible) * 100));
    }
    return out;
  }, [tallyOf]);

  // Grouped by term, newest first. A term is one block: "2026 Term 3 — maths,
  // English, physics" is how somebody thinks about a timetable, not a flat
  // list of eighteen rows.
  const byTerm = useMemo(() => {
    const groups = new Map<string, { term: string; rows: RawRecord[] }>();
    for (const e of taken ?? []) {
      const term = refName(e[E.term]) || 'No term recorded';
      let g = groups.get(term);
      if (!g) groups.set(term, (g = { term, rows: [] }));
      g.rows.push(e);
    }
    for (const g of groups.values()) {
      g.rows.sort((a, b) => refName(a[E.class]).localeCompare(refName(b[E.class])));
    }
    // Terms are named "2026 Term 3", so a reverse string sort is reverse
    // chronological without needing the term records themselves.
    return [...groups.values()].sort((a, b) => b.term.localeCompare(a.term));
  }, [taken]);

  // A pupil of three years has every class they have ever taken in this list.
  // Default to the term the board is on -- that is what somebody opening the
  // panel mid-term wants -- and keep the rest one click away rather than gone.
  // Which row is being dropped, and why. Same shape as the class drawer: a
  // reason is required, because that is the difference between a drop and a
  // deletion -- the record survives and has to say what happened.
  const [dropping, setDropping] = useState<string | null>(null);
  const [dropReason, setDropReason] = useState('');
  const [dropBusy, setDropBusy] = useState(false);

  const [allTerms, setAllTerms] = useState(false);
  const shownTerms = useMemo(
    () => (allTerms ? byTerm : byTerm.filter((g) => g.term === termLabel)),
    [allTerms, byTerm, termLabel],
  );
  // When the student has nothing in the current term, showing an empty list
  // behind a filter they did not set would read as "no classes at all".
  const emptyThisTerm = !allTerms && shownTerms.length === 0 && byTerm.length > 0;

  // Totals across whatever is on screen, so the figures match the rows.
  const totals = useMemo(() => {
    const rows = shownTerms.flatMap((g) => g.rows);
    let present = 0;
    let eligible = 0;
    let owed = 0;
    for (const e of rows) {
      const t = tallyOf.get(e.id);
      if (t) { present += t.present; eligible += t.eligible; }
      const paid = str(e[E.payment_status]);
      if (paid && paid !== 'Paid' && paid !== 'Waived') {
        owed += (int(e[E.fee_amount]) ?? 0) - (int(e[E.discount]) ?? 0);
      }
    }
    return {
      classes: rows.length,
      // Weighted by marks, not an average of percentages: eleven lessons of
      // maths should not count the same as two of physics.
      rate: eligible === 0 ? null : Math.round((present / eligible) * 100),
      owed,
    };
  }, [shownTerms, tallyOf]);

  const saveHouseholdField = (field: string) => async (raw: string) => {
    if (!householdId) return;
    const text = raw.trim();
    const value = text === '' ? null : text;
    await updateHousehold(householdId, { [field]: value });
    setHouse((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

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

  /**
   * One field, one write.
   *
   * An emptied box clears the field rather than storing "": Zoho takes null
   * for that, and a blank string would come back as a value that merely looks
   * absent. The local copy is patched from the same value that was sent, so
   * the panel shows what is now stored without re-reading it.
   */
  const saveStudentField = (field: string, transform?: (v: string) => string) =>
    async (raw: string) => {
      const text = transform ? transform(raw) : raw.trim();
      const value = text === '' ? null : text;
      await updateStudent(studentId, { [field]: value });
      setStudent((prev) => (prev ? { ...prev, [field]: value } : prev));
    };

  const saveAdmissionField = (field: string, transform?: (v: string) => string) =>
    async (raw: string) => {
      if (!appRec) return;
      const text = transform ? transform(raw) : raw.trim();
      const value = text === '' ? null : text;
      await updateAdmission(appRec.id, { [field]: value });
      setAppRec((prev) => (prev ? { ...prev, [field]: value } : prev));
      onAdmissionPatched(appRec.id, { [field]: value });
    };

  return (
    <Drawer
      title={name}
      subtitle={
        student
          ? str(student[ST.student_ref]) ||
            `${str(student[ST.student_code], '—')} · no ref assigned`
          : 'Loading…'
      }
      onClose={onClose}
    >
      {error && <Banner tone="error">{error}</Banner>}
      {/* The pane variant, not inline: this stands in for the whole panel, so
          it is centred in the space the record will fill. Inline left it
          hugging the top-left corner, reading as a stray line under the
          header rather than as the panel working. The two loaders further
          down stay inline -- they sit inside sections that already have
          content around them. */}
      {student === null && !error && showSpinner && <Loader label="Loading record…" />}

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
            <EditableFact
              label="Date of birth"
              type="date"
              value={str(student[ST.date_of_birth])}
              onSave={saveStudentField(ST.date_of_birth)}
            >
              {str(student[ST.date_of_birth], '—')}
              {ageOf(str(student[ST.date_of_birth])) !== null && (
                <span className="muted"> · {ageOf(str(student[ST.date_of_birth]))} years</span>
              )}
            </EditableFact>

            <EditableFact
              label="Gender"
              type="select"
              options={GENDER_VALUES}
              value={str(student[ST.gender])}
              onSave={saveStudentField(ST.gender)}
            >
              {str(student[ST.gender], '—')}
            </EditableFact>

            <EditableFact
              label="Phone"
              type="tel"
              value={str(student[ST.phone])}
              onSave={saveStudentField(ST.phone)}
            >
              {str(student[ST.phone], '—')}
            </EditableFact>

            <EditableFact
              label="Email"
              type="email"
              value={str(student[ST.email])}
              onSave={saveStudentField(ST.email)}
            >
              {str(student[ST.email], '—')}
            </EditableFact>

            <dt>Record no.</dt>
            <dd className="muted">{str(student[ST.student_code], '—')}</dd>

            <dt>On roll since</dt>
            <dd>{str(student[ST.enrollment_date], '—')}</dd>

            <dt>Active classes</dt>
            <dd>{int(student[ST.active_enrollments_count]) ?? 0}</dd>
          </dl>

          {/* What they have actually taken. "Active classes: 1" said there was
              one and left you to guess which; this names the subject and the
              term, and runs back through terms that are over. */}
          <section className="drawer-section">
            <div className="section-head">
              <h3>Classes</h3>
              {byTerm.length > 1 && (
                <Button
                  small
                  variant="ghost"
                  className="section-head-end"
                  onClick={() => setAllTerms((v) => !v)}
                >
                  {allTerms ? `Just ${termLabel}` : 'All terms'}
                </Button>
              )}
            </div>

            {/* Totals for what is on screen, so the figures and the rows
                always agree. */}
            {totals.classes > 0 && (
              <p className="muted totals-line">
                {totals.classes} class{totals.classes === 1 ? '' : 'es'}
                {totals.rate !== null && <> · {totals.rate}% attendance</>}
                {totals.owed > 0 && <> · {totals.owed.toLocaleString()} outstanding</>}
              </p>
            )}

            {takenError && <Banner tone="error">{takenError}</Banner>}
            {taken === null && !takenError ? (
              <Loader inline label="Loading classes…" />
            ) : byTerm.length === 0 ? (
              <p className="muted">Not enrolled in any class yet.</p>
            ) : emptyThisTerm ? (
              <p className="muted">
                Nothing in {termLabel}.{' '}
                <button type="button" className="roster-name-btn" onClick={() => setAllTerms(true)}>
                  Show all terms
                </button>
              </p>
            ) : (
              shownTerms.map((group) => (
                <div key={group.term} className="term-group">
                  <h4>{group.term}</h4>
                  <ul className="roster">
                    {group.rows.map((e) => {
                      const status = str(e[E.status]);
                      const grade = str(e[E.final_grade]);
                      const klass = klasses.get(refId(e[E.class]) ?? '');
                      const days = klass ? strList(klass[C.meeting_days]) : [];
                      const time = klass
                        ? [str(klass[C.start_time]), str(klass[C.end_time])].filter(Boolean).join('–')
                        : '';
                      const rate = rateOf.get(e.id);
                      const fee = int(e[E.fee_amount]);
                      const paid = str(e[E.payment_status]);
                      // The course must be offered by the programme the
                      // student was admitted to. This is the check nothing
                      // enforced when the placement was made.
                      const courseId = refId(e[E.course]) ?? '';
                      const offered = offeringsOf.get(courseId) ?? [];
                      const myProgram = refId(student[ST.program]);
                      const offProgramme =
                        myProgram !== null &&
                        offered.length > 0 &&
                        !offered.some((pr) => pr.id === myProgram);
                      return (
                        <li key={e.id}>
                          <span className="cell-lines">
                            {klass ? (
                              <button
                                type="button"
                                className="roster-name-btn"
                                title="Open this class"
                                onClick={() => onOpenClass(klass)}
                              >
                                {refName(e[E.class]) || '—'}
                              </button>
                            ) : (
                              <span className="cell-title">{refName(e[E.class]) || '—'}</span>
                            )}
                            <span className="cell-sub">
                              {refName(e[E.course]) || 'No course recorded'}
                              {days.length > 0 && <> · {shortDays(days)}</>}
                              {time && <> {time}</>}
                              {klass && str(klass[C.room]) && <> · {str(klass[C.room])}</>}
                            </span>
                            <span className="cell-sub">
                              {klass && refName(klass[C.primary_teacher])
                                ? refName(klass[C.primary_teacher])
                                : 'No teacher'}
                              {marks === null ? (
                                <> · …</>
                              ) : rate === undefined || rate === null ? (
                                <> · no marks</>
                              ) : (
                                <> · {rate}% attendance</>
                              )}
                              {grade && <> · Grade {grade}</>}
                              {fee !== null && (
                                <> · {fee.toLocaleString()}{paid && ` (${paid})`}</>
                              )}
                            </span>
                            {offProgramme && (
                              <span className="cell-sub warn-text">
                                <Icon name="alert" size={13} />
                                Not offered by {refName(student[ST.program])}
                              </span>
                            )}
                          </span>
                          {status !== 'Active' ? (
                            <Badge tone={status === 'Completed' ? 'positive' : 'neutral'}>
                              {status || '—'}
                            </Badge>
                          ) : dropping === e.id ? (
                            <span className="roster-confirm roster-drop">
                              <input
                                type="text"
                                value={dropReason}
                                autoFocus
                                maxLength={2000}
                                placeholder="Why are they leaving?"
                                aria-label={`Reason for leaving ${refName(e[E.class])}`}
                                onChange={(ev) => setDropReason(ev.target.value)}
                              />
                              <Button
                                small
                                variant="primary"
                                disabled={dropBusy || dropReason.trim() === ''}
                                onClick={async () => {
                                  setDropBusy(true);
                                  await onDropEnrolment(e.id, name, dropReason.trim());
                                  // The board patched its own copy; this panel
                                  // read the enrolments separately, so it has
                                  // to patch its own too.
                                  setTaken((prev) =>
                                    (prev ?? []).map((r) =>
                                      r.id === e.id
                                        ? { ...r, [E.status]: 'Dropped', [E.dropped_on]: orgToday() }
                                        : r,
                                    ),
                                  );
                                  setDropBusy(false);
                                  setDropping(null);
                                  setDropReason('');
                                }}
                              >
                                {dropBusy ? 'Dropping…' : 'Drop'}
                              </Button>
                              <Button
                                small
                                variant="ghost"
                                disabled={dropBusy}
                                onClick={() => { setDropping(null); setDropReason(''); }}
                              >
                                Cancel
                              </Button>
                            </span>
                          ) : (
                            <Button
                              small
                              variant="ghost"
                              title={`${name} is leaving ${refName(e[E.class])}`}
                              onClick={() => { setDropping(e.id); setDropReason(''); }}
                            >
                              Drop
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>                </div>
              ))
            )}
          </section>

          <section className="drawer-section">
            <h3>In an emergency</h3>
            <dl className="facts">
              <EditableFact
                label="Name"
                value={str(student[ST.emergency_contact_name])}
                onSave={saveStudentField(ST.emergency_contact_name)}
              >
                {str(student[ST.emergency_contact_name]) || (
                  <span className="muted">Nobody on file</span>
                )}
              </EditableFact>

              <EditableFact
                label="Phone"
                type="tel"
                value={str(student[ST.emergency_contact_phone])}
                onSave={saveStudentField(ST.emergency_contact_phone)}
              >
                {str(student[ST.emergency_contact_phone], '—')}
              </EditableFact>
            </dl>

            {/* Nothing on the child, but the family record has a number. Said
                here rather than left to be discovered further down the panel:
                this is the section somebody opens when it matters. */}
            {!str(student[ST.emergency_contact_name]) &&
              !str(student[ST.emergency_contact_phone]) &&
              house !== null &&
              (str(house[H.phone]) || str(house[H.mobile])) && (
                <p className="muted fallback-note">
                  Nothing recorded on {str(student[ST.full_name], name)}. The household
                  lists{' '}
                  <strong>
                    {str(house[H.primary_guardian_name]) || str(house[H.household_name], 'the family')}
                  </strong>{' '}
                  on {str(house[H.mobile]) || str(house[H.phone])}.
                </p>
              )}
          </section>

          {/* Called out rather than left as one row in the table above: if
              there is anything here, whoever is about to put this student in
              a class needs to have seen it. */}
          <EditableNote
            label="Medical notes"
            value={str(student[ST.medical_notes])}
            placeholder="Allergies, medication, anything a teacher must know"
            empty="None recorded."
            tone="warn"
            onSave={saveStudentField(ST.medical_notes)}
          />


          {/* The family record. Reached from the student, shown in full here:
              a name under the avatar is not a contact, and in an emergency
              the number that actually reaches somebody lives on this record,
              not on the child's. */}
          {houseError && <Banner tone="error">{houseError}</Banner>}

          {!householdId ? (
            <section className="drawer-section">
              <h3>Household</h3>
              <p className="muted">
                No household linked to this student, so there is no family
                contact record to show.
              </p>
            </section>
          ) : house === null ? (
            !houseError && <Loader inline label="Loading household…" />
          ) : (
            <>
              <section className="drawer-section">
                <h3>Household</h3>
                <dl className="facts">
                  <EditableFact
                    label="Family"
                    value={str(house[H.household_name])}
                    onSave={saveHouseholdField(H.household_name)}
                  >
                    {str(house[H.household_name], '—')}
                  </EditableFact>

                  <dt>Code</dt>
                  <dd>{str(house[H.household_code], '—')}</dd>

                  <EditableFact
                    label="Billing"
                    type="select"
                    options={BILLING_STATUS_VALUES}
                    value={str(house[H.billing_status])}
                    onSave={saveHouseholdField(H.billing_status)}
                  >
                    {str(house[H.billing_status], '—')}
                  </EditableFact>

                  <dt>Children on roll</dt>
                  <dd>{int(house[H.active_students_count]) ?? 0}</dd>
                </dl>
              </section>

              <section className="drawer-section">
                <h3>Primary guardian</h3>
                <dl className="facts">
                  <EditableFact
                    label="Name"
                    value={str(house[H.primary_guardian_name])}
                    onSave={saveHouseholdField(H.primary_guardian_name)}
                  >
                    {str(house[H.primary_guardian_name]) || (
                      <span className="muted">Nobody named</span>
                    )}
                  </EditableFact>

                  <EditableFact
                    label="Relationship"
                    type="select"
                    options={GUARDIAN_RELATIONSHIP_VALUES}
                    value={str(house[H.primary_guardian_relationship])}
                    onSave={saveHouseholdField(H.primary_guardian_relationship)}
                  >
                    {str(house[H.primary_guardian_relationship], '—')}
                  </EditableFact>

                  <EditableFact
                    label="Phone"
                    type="tel"
                    value={str(house[H.phone])}
                    onSave={saveHouseholdField(H.phone)}
                  >
                    {str(house[H.phone], '—')}
                  </EditableFact>

                  <EditableFact
                    label="Mobile"
                    type="tel"
                    value={str(house[H.mobile])}
                    onSave={saveHouseholdField(H.mobile)}
                  >
                    {str(house[H.mobile], '—')}
                  </EditableFact>

                  <EditableFact
                    label="Email"
                    type="email"
                    value={str(house[H.email])}
                    onSave={saveHouseholdField(H.email)}
                  >
                    {str(house[H.email], '—')}
                  </EditableFact>

                  <EditableFact
                    label="Prefers"
                    type="select"
                    options={CONTACT_METHOD_VALUES}
                    value={str(house[H.preferred_contact_method])}
                    onSave={saveHouseholdField(H.preferred_contact_method)}
                  >
                    {str(house[H.preferred_contact_method], '—')}
                  </EditableFact>
                </dl>
              </section>

              <section className="drawer-section">
                <h3>Secondary guardian</h3>
                <dl className="facts">
                  <EditableFact
                    label="Name"
                    value={str(house[H.secondary_guardian_name])}
                    onSave={saveHouseholdField(H.secondary_guardian_name)}
                  >
                    {str(house[H.secondary_guardian_name]) || (
                      <span className="muted">Nobody named</span>
                    )}
                  </EditableFact>

                  <EditableFact
                    label="Relationship"
                    type="select"
                    options={GUARDIAN_RELATIONSHIP_VALUES}
                    value={str(house[H.secondary_guardian_relationship])}
                    onSave={saveHouseholdField(H.secondary_guardian_relationship)}
                  >
                    {str(house[H.secondary_guardian_relationship], '—')}
                  </EditableFact>

                  <EditableFact
                    label="Phone"
                    type="tel"
                    value={str(house[H.secondary_guardian_phone])}
                    onSave={saveHouseholdField(H.secondary_guardian_phone)}
                  >
                    {str(house[H.secondary_guardian_phone], '—')}
                  </EditableFact>

                  <EditableFact
                    label="Email"
                    type="email"
                    value={str(house[H.secondary_guardian_email])}
                    onSave={saveHouseholdField(H.secondary_guardian_email)}
                  >
                    {str(house[H.secondary_guardian_email], '—')}
                  </EditableFact>
                </dl>
              </section>

              <section className="drawer-section">
                <h3>Address</h3>
                <dl className="facts">
                  <EditableFact
                    label="Street"
                    value={str(house[H.address_line])}
                    onSave={saveHouseholdField(H.address_line)}
                  >
                    {str(house[H.address_line], '—')}
                  </EditableFact>

                  <EditableFact
                    label="City"
                    value={str(house[H.city])}
                    onSave={saveHouseholdField(H.city)}
                  >
                    {str(house[H.city], '—')}
                  </EditableFact>

                  <EditableFact
                    label="Postcode"
                    value={str(house[H.postcode])}
                    onSave={saveHouseholdField(H.postcode)}
                  >
                    {str(house[H.postcode], '—')}
                  </EditableFact>

                  <EditableFact
                    label="Country"
                    value={str(house[H.country])}
                    onSave={saveHouseholdField(H.country)}
                  >
                    {str(house[H.country], '—')}
                  </EditableFact>
                </dl>
              </section>

              <EditableNote
                label="Household notes"
                value={str(house[H.notes])}
                placeholder="Anything about the family worth recording"
                empty="None recorded."
                onSave={saveHouseholdField(H.notes)}
              />
            </>
          )}

          <section className="drawer-section">
            <h3>Application</h3>
            {appRec === null ? (
              <p className="muted">
                No application for {termLabel}. This student is on the roll from an
                earlier term.
              </p>
            ) : (
              <>
                <dl className="facts">
                  <dt>Application</dt>
                  <dd>{str(appRec[A.application_no], '—')}</dd>

                  <dt>Stage</dt>
                  <dd>{str(appRec[A.stage], '—')}</dd>

                  <dt>Came from</dt>
                  <dd>{str(appRec[A.source], '—')}</dd>

                  <dt>Applied</dt>
                  <dd>{str(appRec[A.applied_date], '—')}</dd>

                  <EditableFact
                    label="Interview"
                    type="datetime-local"
                    value={localDateTime(appRec[A.interview_date])}
                    /* A datetime, so it is stamped with the org's offset --
                       never a bare local string and never a trailing Z. */
                    onSave={saveAdmissionField(A.interview_date, (v) =>
                      v ? orgDateTime(v) : '',
                    )}
                  >
                    {str(appRec[A.interview_date]) || (
                      <span className="muted">Not scheduled</span>
                    )}
                  </EditableFact>

                  <EditableFact
                    label="Decided"
                    type="date"
                    value={str(appRec[A.decision_date])}
                    onSave={saveAdmissionField(A.decision_date)}
                  >
                    {str(appRec[A.decision_date]) || (
                      <span className="muted">Not recorded</span>
                    )}
                  </EditableFact>

                  <EditableFact
                    label="Guardian"
                    value={str(appRec[A.guardian_name])}
                    onSave={saveAdmissionField(A.guardian_name)}
                  >
                    {str(appRec[A.guardian_name], '—')}
                  </EditableFact>

                  <EditableFact
                    label="Guardian phone"
                    type="tel"
                    value={str(appRec[A.guardian_phone])}
                    onSave={saveAdmissionField(A.guardian_phone)}
                  >
                    {str(appRec[A.guardian_phone], '—')}
                  </EditableFact>

                  <EditableFact
                    label="Guardian email"
                    type="email"
                    value={str(appRec[A.guardian_email])}
                    onSave={saveAdmissionField(A.guardian_email)}
                  >
                    {str(appRec[A.guardian_email], '—')}
                  </EditableFact>
                </dl>

                <EditableNote
                  label="Notes"
                  value={str(appRec[A.notes])}
                  placeholder="Anything worth knowing about this application"
                  empty="None."
                  onSave={saveAdmissionField(A.notes)}
                />
              </>
            )}
          </section>
        </>
      )}
    </Drawer>
  );
}

/**
 * One row of the fact grid, editable in place.
 *
 * Renders the dt/dd pair itself rather than wrapping one, so the grid stays a
 * real <dl> and the labels keep lining up down the column.
 *
 * The write belongs to this row: while it is in flight only this row is busy,
 * and a rejection is shown under this field rather than as a banner about the
 * record. Enter commits and Escape reverts, because a value typed into a box
 * that then needs a separate click to stick is a value people lose.
 */
function EditableFact({
  label,
  value,
  children,
  type = 'text',
  options,
  onSave,
}: {
  label: string;
  /** The value as an input holds it -- not the same as how it reads. */
  value: string;
  /** How the field reads when it is not being edited. */
  children: ReactNode;
  type?: 'text' | 'tel' | 'email' | 'date' | 'datetime-local' | 'select';
  options?: readonly string[];
  onSave: (value: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  function start() {
    setDraft(value);
    setFailed(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setFailed(null);
  }

  async function commit() {
    // Nothing typed, nothing sent -- an unchanged value would still restamp
    // Modified_By on the record.
    if (draft === value) { setEditing(false); return; }
    setSaving(true);
    setFailed(null);
    try {
      await onSave(draft);
      setEditing(false);
    } catch (err) {
      // Stays open and keeps what was typed: closing would throw the edit away
      // and leave the old value looking like it had been accepted.
      setFailed(describeError(err));
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <>
        <dt>{label}</dt>
        <dd className="fact-row">
          <span className="fact-value">{children}</span>
          <button
            type="button"
            className="fact-edit"
            aria-label={`Edit ${label.toLowerCase()}`}
            title={`Edit ${label.toLowerCase()}`}
            onClick={start}
          >
            <Icon name="pencil" size={13} />
          </button>
        </dd>
      </>
    );
  }

  return (
    <>
      <dt>{label}</dt>
      <dd className="fact-row is-editing">
        <span className="fact-input">
          {type === 'select' ? (
            <select
              className="field"
              autoFocus
              value={draft}
              disabled={saving}
              aria-label={label}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') cancel(); }}
            >
              <option value="">—</option>
              {(options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input
              className="field"
              type={type}
              autoFocus
              value={draft}
              disabled={saving}
              aria-label={label}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); void commit(); }
                if (e.key === 'Escape') cancel();
              }}
            />
          )}
          <Button small variant="primary" disabled={saving} onClick={() => void commit()}>
            {saving ? '…' : <Icon name="check" size={14} />}
          </Button>
          <Button small variant="ghost" disabled={saving} onClick={cancel} aria-label="Cancel">
            <Icon name="close" size={14} />
          </Button>
        </span>
        {failed && <span className="field-error">{failed}</span>}
      </dd>
    </>
  );
}

/**
 * A free-text block with its own edit control, for the two fields too long to
 * sit in the fact grid.
 *
 * Same contract as EditableFact -- one field, one write, failure stays on the
 * block -- but the heading carries the pencil and the value gets the full
 * width of the panel.
 */
function EditableNote({
  label,
  value,
  placeholder,
  empty,
  tone,
  onSave,
}: {
  label: string;
  value: string;
  placeholder: string;
  /** What to say when there is nothing recorded. */
  empty: string;
  /** 'warn' gives the filled-in state a banner; plain text otherwise. */
  tone?: 'warn';
  onSave: (value: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function commit() {
    if (draft === value) { setEditing(false); return; }
    setSaving(true);
    setFailed(null);
    try {
      await onSave(draft);
      setEditing(false);
    } catch (err) {
      setFailed(describeError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="drawer-section">
      <div className="section-head">
        <h3>{label}</h3>
        {!editing && (
          <button
            type="button"
            className="fact-edit"
            aria-label={`Edit ${label.toLowerCase()}`}
            title={`Edit ${label.toLowerCase()}`}
            onClick={() => { setDraft(value); setFailed(null); setEditing(true); }}
          >
            <Icon name="pencil" size={13} />
          </button>
        )}
      </div>

      {editing ? (
        <>
          <textarea
            className="field"
            rows={3}
            maxLength={2000}
            autoFocus
            value={draft}
            disabled={saving}
            placeholder={placeholder}
            aria-label={label}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false); }}
          />
          {failed && <span className="field-error">{failed}</span>}
          <div className="note-actions">
            <Button small variant="primary" disabled={saving} onClick={() => void commit()}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button small variant="ghost" disabled={saving} onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </>
      ) : value ? (
        tone === 'warn' ? (
          <Banner tone="warn">{value}</Banner>
        ) : (
          <p className="note-inline">{value}</p>
        )
      ) : (
        <p className="muted">{empty}</p>
      )}
    </section>
  );
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
