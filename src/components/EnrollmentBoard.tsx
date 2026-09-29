import { useCallback, useEffect, useMemo, useState } from 'react';
import { ZOHO_MODULES } from '../generated/types';
import { Loader, useDelayed } from './Loader';
import { Avatar, Badge, Banner, Button, Chip, EmptyState, Icon, Toast } from './ui';
import { classTone, shortDays } from './status';
import {
  createEnrollment,
  describeError,
  getActiveStudents,
  getAdmissionsForTerm,
  getEnrollmentsForClasses,
  isAlreadyEnrolled,
  int,
  orgToday,
  refId,
  refName,
  str,
  strList,
  type RawRecord,
} from '../zoho/client';

const C = ZOHO_MODULES.classes.fields;
const E = ZOHO_MODULES.enrollments.fields;
const A = ZOHO_MODULES.admissions.fields;
const ST = ZOHO_MODULES.students.fields;
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

  // The keyboard path: a card is "picked up" by activating it, then a class is
  // chosen. Dragging is the same two steps with a pointer, so both drive this.
  const [picked, setPicked] = useState<Candidate | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
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
    setPicked(null);
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
  const shownPeople = useMemo(() => {
    const q = studentQuery.trim().toLowerCase();
    return (candidates ?? []).filter((c) => {
      if (programId && source === 'admitted' && c.programId !== programId) return false;
      if (!q) return true;
      return `${c.name} ${c.detail}`.toLowerCase().includes(q);
    });
  }, [candidates, studentQuery, programId, source]);

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
  const pickedNotAdmitted =
    picked !== null && admittedIds !== null && !admittedIds.has(picked.studentId);

  const enroll = useCallback(
    async (klass: RawRecord, who: Candidate) => {
      if (busyClass) return;
      // The buttons are already withheld, so this is the backstop for a drop
      // that got through some other way.
      if (admittedIds !== null && !admittedIds.has(who.studentId)) {
        setToast({
          tone: 'warn',
          message: `${who.name} has no application for ${termLabel}. Admit them first.`,
        });
        return;
      }
      setBusyClass(klass.id);
      setError(null);
      const classLabel = str(klass[C.class_code], str(klass[C.name], klass.id));
      try {
        // Nothing server-side enforces the (student, class) pair, so this is
        // the check -- and it reads through the relationship, which sees rows
        // the search index has not caught up with yet.
        if (await isAlreadyEnrolled(klass.id, who.studentId)) {
          // Not an error -- the guard doing its job. A red banner that stays
          // on screen overstates it, and the board is still perfectly usable.
          setToast({
            tone: 'warn',
            message: `${who.name} is already enrolled in ${classLabel}.`,
          });
          return;
        }

        const id = await createEnrollment({
          studentId: who.studentId,
          classId: klass.id,
          studentLabel: who.name,
          classLabel,
          courseId: refId(klass[C.course]) ?? undefined,
          termId,
        });

        // Appended locally, NOT re-read.
        //
        // Re-reading is what broke this the first time round: the read went
        // through searchRecord, whose index does not contain a row written a
        // second ago, so it returned the list *without* what had just been
        // created. The seat count did not move and the drop looked as though
        // it had failed -- while the duplicate guard, which reads through the
        // relationship and has no such lag, refused the retry.
        //
        // Everything the board derives -- seat counts and which classes a
        // student is in -- comes from student, class and status, all of which
        // are known here. So the row is built rather than fetched.
        setEnrollments((prev) => [
          ...(prev ?? []),
          {
            id,
            [E.student]: { id: who.studentId, name: who.name },
            [E.class]: { id: klass.id, name: classLabel },
            [E.term]: { id: termId },
            [E.status]: 'Active',
          },
        ]);
        setToast({ tone: 'positive', message: `Enrolled ${who.name} in ${classLabel}.` });
        setPicked(null);
      } catch (err) {
        setError(describeError(err));
      } finally {
        setBusyClass(null);
      }
    },
    [busyClass, termId, admittedIds, termLabel],
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
    if (!picked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPicked(null);
        setAnnouncement('Cancelled.');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picked]);

  return (
    <div className="board">
      {/* Announces holding and dropping a student; outcomes go to the toast. */}
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>

      {toast && (
        <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} />
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
              onClick={() => { setSource('admitted'); setPicked(null); }}
            >
              Admitted
            </Button>
            <Button
              className={source === 'active' ? 'is-on' : undefined}
              aria-pressed={source === 'active'}
              onClick={() => { setSource('active'); setPicked(null); }}
            >
              All active
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
            title={source === 'admitted' ? 'Nobody admitted for this term' : 'No active students'}
            detail={
              source === 'admitted'
                ? 'Applications land here once accepted, with a student record behind them.'
                : 'Add them in the Students module, or admit them through Admissions.'
            }
          >
            {/* The prose used to tell you to switch lists. Better to offer it:
                an existing pupil not in this term's intake is the commonest
                reason for this panel to be showing at all. */}
            {source === 'admitted' && (
              <Button small onClick={() => { setSource('active'); setPicked(null); }}>
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
                  : 'Nobody was admitted into this programme for this term.'
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
              classesOf={classesOf}
              pickedId={picked?.studentId ?? null}
              disabled={busyClass !== null}
              onPick={(next) => {
                setPicked(next);
                // Whatever went wrong last time was about the last attempt.
                setError(null);
                setAnnouncement(next ? `${next.name} picked up. Choose a class.` : 'Cancelled.');
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

        {!loading && pickedNotAdmitted && picked && (
          <Banner tone="warn" icon="user">
            <strong>{picked.name}</strong> has no application for{' '}
            <strong>{termLabel}</strong>, so they cannot be enrolled into it.
            Add one in the Admissions module first — a student is admitted for
            each term they attend.
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

        {!loading && shownClasses.map((k) => (
          <ClassDrop
            key={k.id}
            klass={k}
            seats={countOf.get(k.id) ?? 0}
            picked={picked}
            notAdmitted={pickedNotAdmitted}
            programName={programOf.get(k.id)?.name ?? ''}
            alreadyIn={picked ? (classesOf.get(picked.studentId)?.has(k.id) ?? false) : false}
            busy={busyClass === k.id}
            disabled={busyClass !== null}
            dragOver={dragOver === k.id}
            onDragOver={setDragOver}
            onEnroll={enroll}
          />
        ))}
      </div>
    </div>
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
  picked,
  notAdmitted,
  programName,
  alreadyIn,
  busy,
  disabled,
  dragOver,
  onDragOver,
  onEnroll,
}: {
  klass: RawRecord;
  seats: number;
  picked: Candidate | null;
  /** The held student has no application for this term, so no class accepts them. */
  notAdmitted: boolean;
  /** The department this class's course belongs to; '' when it has none. */
  programName: string;
  alreadyIn: boolean;
  busy: boolean;
  disabled: boolean;
  dragOver: boolean;
  onDragOver: (id: string | null) => void;
  onEnroll: (klass: RawRecord, who: Candidate) => void;
}) {
  const capacity = int(klass[C.capacity]);
  const days = strList(klass[C.meeting_days]);
  const status = classTone(str(klass[C.status]));
  const full = capacity !== null && seats >= capacity;
  const droppable = picked !== null && !alreadyIn && !notAdmitted && !disabled;
  const time = [str(klass[C.start_time]), str(klass[C.end_time])].filter(Boolean).join('–');

  return (
    <div
      className={[
        'drop-card',
        dragOver && droppable ? 'drop-over' : '',
        picked && (alreadyIn || notAdmitted) ? 'drop-blocked' : '',
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
        if (droppable && picked) onEnroll(klass, picked);
      }}
    >
      <div className="drop-card-main">
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
      </div>

      <div className="drop-card-side">
        <Chip>
          <Icon name="users" size={13} />
          {capacity === null ? `${seats}` : `${seats} / ${capacity}`}
        </Chip>
        {full && <Badge tone="pending" dot>Full</Badge>}
        <Badge tone={status.tone} dot>{status.label}</Badge>
      </div>

      {/* Only while a student is held. A button on every class at all times
          would read as the card's primary action, which it is not. */}
      {picked && (
        <div className="drop-card-action">
          {alreadyIn ? (
            <span className="muted cover-mark">
              <Icon name="check" size={14} />
              {picked.name} is already in this class
            </span>
          ) : notAdmitted ? (
            <span className="muted cover-mark">
              <Icon name="alert" size={14} />
              Not admitted for this term
            </span>
          ) : (
            <Button
              variant={full ? 'default' : 'primary'}
              small
              disabled={disabled}
              onClick={() => onEnroll(klass, picked)}
            >
              {busy ? 'Enrolling…' : full ? `Enrol ${picked.name} anyway` : `Enrol ${picked.name}`}
            </Button>
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
  classesOf,
  pickedId,
  disabled,
  onPick,
}: {
  people: Candidate[];
  classesOf: Map<string, Set<string>>;
  pickedId: string | null;
  disabled: boolean;
  onPick: (next: Candidate | null) => void;
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
              classCount={classesOf.get(c.studentId)?.size ?? 0}
              picked={pickedId === c.studentId}
              disabled={disabled}
              onPick={onPick}
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
  picked,
  disabled,
  onPick,
}: {
  person: Candidate;
  classCount: number;
  picked: boolean;
  disabled: boolean;
  onPick: (next: Candidate | null) => void;
}) {
  return (
    <button
      type="button"
      className={`pick-card${picked ? ' is-picked' : ''}`}
      draggable={!disabled}
      aria-pressed={picked}
      disabled={disabled}
      onClick={() => onPick(picked ? null : person)}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'copy';
        // Some browsers cancel a drag that carries no payload at all.
        e.dataTransfer.setData('text/plain', person.studentId);
        onPick(person);
      }}
      onDragEnd={() => onPick(null)}
    >
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
