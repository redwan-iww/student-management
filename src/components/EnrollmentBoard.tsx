import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import {
  BILLING_STATUS_VALUES,
  CONTACT_METHOD_VALUES,
  GENDER_VALUES,
  GUARDIAN_RELATIONSHIP_VALUES,
  ZOHO_MODULES,
} from '../generated/types';
import { Loader, useDelayed } from './Loader';
import {
  Avatar, Badge, Banner, Button, Chip, DateField, Drawer, EmptyState, hueOf, Icon, Toast, ToolbarEnd,
} from './ui';
import { classTone, effectiveClassStatus, shiftOf, shortDays } from './status';
import {
  placeAdmissionBatch,
  unplaceAdmission,
  describeError,
  getAllocationsForClass,
  attendanceRate,
  dropAdmission,
  getAttendanceForStudent,
  getAttendanceStatsForClass,
  getClassesByIds,
  getAdmissionsForStudent,
  getHousehold,
  getStudent,
  getAdmissionsForTerm,
  getActiveStudents,
  getAdmissionsForClass,
  int,
  orgToday,
  refId,
  refName,
  str,
  strList,
  updateHousehold,
  updateStudent,
  type AttendanceStats,
  type Placement,
  type RawRecord,
} from '../zoho/client';

const C = ZOHO_MODULES.classes.fields;
const A = ZOHO_MODULES.admissions.fields;
const ST = ZOHO_MODULES.students.fields;
const AL = ZOHO_MODULES.allocations.fields;
const T = ZOHO_MODULES.terms.fields;
const H = ZOHO_MODULES.households.fields;
const AT = ZOHO_MODULES.attendance.fields;

/**
 * Whether an admission means the student is, or was, in that class.
 *
 * Placed and Completed both do. A finished term's admissions are Completed --
 * the seat was taken, the register was kept, a grade came out of it -- so a
 * class that ran to the end is not an empty class. Dropped does not: that is
 * the whole point of dropping rather than un-placing. Admitted is not a
 * placement yet -- it is a card still waiting on the left.
 *
 * Seats, the per-student class count and the drawer's roster all read this,
 * so they cannot disagree.
 *
 * It tested  until the admission model landed, which is a stage that
 * no longer exists: every seat count on the board read zero while the classes
 * behind them were full.
 */
function holdsPlace(stage: string): boolean {
  return stage === 'Placed' || stage === 'Completed';
}

/** Where the right-hand column gets its people from. */

/**
 * One admission waiting for a class -- a card on the left of the board.
 *
 * The card is a person *and a subject*, not a person. A student admitted to
 * five courses is five cards, each of which can only go into a class of its
 * own course. That is the whole reason the board can check a drop at all: the
 * card already says what the student is entitled to sit.
 */
interface Candidate {
  /** The admission row. The identity of the card, and what placing updates. */
  admissionId: string;
  studentId: string;
  name: string;
  courseId: string;
  courseName: string;
  /** The student's readable id, for telling two people of a name apart. */
  detail: string;
}

/** One placed admission, as the class drawer shows it. */
interface RosterRow {
  admissionId: string;
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
/**
 * A placement that has been made on the board but not yet written.
 *
 * Carries the student's name and programme rather than just the id: the card
 * has to show who is staged, and the programme check has to be re-runnable
 * without going back to the roll, which may have been filtered since.
 */
interface Staged {
  /** The admission being placed -- what Save updates. */
  admissionId: string;
  classId: string;
  classLabel: string;
  studentId: string;
  name: string;
  courseName: string;
}

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
  classesMet,
}: {
  /**
   * The whole record, not just its id: the board needs the enrolment window
   * off it to say when someone is being added after applications closed.
   */
  term: RawRecord;
  classes: RawRecord[];
  /**
   * Classes with a register taken against a past lesson -- the proof that a
   * class is running rather than merely planned. Read by the screen above and
   * handed down, because the staffing table needs the same answer and it is
   * one read of the sessions module for both.
   */
  classesMet: ReadonlySet<string>;
}) {
  const termId = term.id;
  const termLabel = str(term[T.name], 'this term');
  // Scrolling is not a way to find one student among a thousand, and there is
  // no server-side search to lean on -- the whole term is already in memory by
  // the time the board renders, so the filter is applied here.
  const [studentQuery, setStudentQuery] = useState('');
  const [classQuery, setClassQuery] = useState('');
  // One read, where there were three.
  //
  // There used to be admissions (who applied), enrollments (who sits where)
  // and students (the whole roll), kept apart because they changed on
  // different things. An admission now names the subject *and* carries the
  // class, so all three questions are asked of this one list: a row without a
  // class is a card still waiting, a row with one is a place taken, and the
  // student is on every row either way.
  const [admissionsRaw, setAdmissionsRaw] = useState<RawRecord[] | null>(null);
  // Student id by student. An admission's Student lookup carries only an id
  // and a name, and the card wants the readable id -- STU-2026T3-026 -- which
  // lives on the student record. One read of the roll for the whole list,
  // rather than a hop per card. It carries no term, so changing term is not a
  // reason to re-read it.
  const [refOf, setRefOf] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);

  // A set, not one student. With a hundred to place across eleven classes,
  // one drag per placement is hundreds of drags -- and the held card scrolls
  // out of sight while you hunt for the class. Tick several, then send them to
  // a class in one go. Dragging still works and simply means "just this one".
  const [selected, setSelected] = useState<Candidate[]>([]);
  const [dragOver, setDragOver] = useState<string | null>(null);
  // The class column's scroller, so a drag held near its edge can move it.
  const classScroll = useRef<HTMLDivElement>(null);
  useDragAutoScroll(classScroll);
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
  // Placements made but not written. The board is an editor now, not a
  // remote control: a drop puts a student on a card and nothing leaves the
  // browser until Save. That is what makes placing one student across five
  // subjects -- and changing your mind about the third -- a single action
  // instead of five writes and a correction.
  const [staged, setStaged] = useState<Staged[]>([]);
  const [saving, setSaving] = useState(false);
  // What just happened. The Toast is itself the live region, so this is the
  // one channel -- sighted and otherwise -- rather than a visible message and
  // a separate hidden announcement that have to be kept in step.
  const [toast, setToast] = useState<{ tone: 'positive' | 'warn'; message: string } | null>(null);
  // Picking a student up and putting them down needs announcing, but does not
  // deserve a toast: it is a state the page already shows.
  const [announcement, setAnnouncement] = useState('');

  /**
   * The cards: admissions with no class, and none staged for one.
   *
   * Both halves matter. A placed admission is done. A staged one is spoken
   * for -- it is sitting on a class card in the Adding-on-save strip, and
   * leaving a copy here would offer a subject that already has somewhere to
   * go, with no second class to put it in: one admission is one course is one
   * seat. Take it off the strip and it comes back.
   *
   * Neither is filtered out of `admissionsRaw`, where the seat counts and the
   * rosters read them.
   */
  const candidates = useMemo((): Candidate[] | null => {
    if (admissionsRaw === null) return null;
    const spokenFor = new Set(staged.map((row) => row.admissionId));
    return admissionsRaw
      .filter((r) => !refId(r[A.class]) && !spokenFor.has(r.id))
      .map((r): Candidate => ({
        admissionId: r.id,
        studentId: refId(r[A.student]) ?? '',
        name: refName(r[A.student]),
        courseId: refId(r[A.course]) ?? '',
        courseName: refName(r[A.course]) || 'No course',
        // The student's id, not the admission's. APP-182 is this row's own
        // autonumber -- it names a subject-for-a-person and means nothing off
        // this screen; STU-2026T3-014 is the person, which is what a register
        // or a letter would carry.
        detail: refOf.get(refId(r[A.student]) ?? '') ?? '',
      }))
      .filter((c) => c.studentId && c.courseId);
  }, [admissionsRaw, staged, refOf]);

  // The two columns settle independently, so they say so independently.
  // Keyed on the admission, not the student. One person is several cards --
  // one per subject -- and ticking their maths card must not tick their
  // physics one.
  const selectedIds = useMemo(() => new Set(selected.map((c) => c.admissionId)), [selected]);

  const toggle = useCallback((who: Candidate) => {
    setSelected((prev) =>
      prev.some((c) => c.admissionId === who.admissionId)
        ? prev.filter((c) => c.admissionId !== who.admissionId)
        : [...prev, who],
    );
  }, []);

  const loading = admissionsRaw === null;
  const peopleLoading = candidates === null;
  const showSpinner = useDelayed(loading);
  const showPeopleSpinner = useDelayed(peopleLoading);

  // One read for the whole board. Where there were three -- applications,
  // enrolments per class, the roll -- there is now one term-wide search, and
  // the cards, the seat counts and the rosters are all derived from it.
  useEffect(() => {
    let cancelled = false;
    setAdmissionsRaw(null);
    setSelected([]);
    setError(null);
    getAdmissionsForTerm(termId)
      .then((recs) => { if (!cancelled) setAdmissionsRaw(recs); })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(describeError(err));
        setAdmissionsRaw([]);
      });
    return () => { cancelled = true; };
  }, [termId]);

  // Staged placements name classes of the term on screen, so they cannot
  // survive a change of term -- the ids would point at classes no longer
  // loaded.
  useEffect(() => { setStaged([]); }, [termId]);

  // Read once, on mount. A missing ref leaves the line blank rather than
  // failing the board: the card is still perfectly usable without it, and the
  // roll is a separate read that may legitimately be slower than the
  // admissions it annotates.
  useEffect(() => {
    let cancelled = false;
    getActiveStudents()
      .then((recs) => {
        if (cancelled) return;
        const m = new Map<string, string>();
        for (const r of recs) {
          const ref = str(r[ST.student_ref]);
          if (ref) m.set(r.id, ref);
        }
        setRefOf(m);
      })
      .catch(() => { /* the id is a nicety; the board works without it */ });
    return () => { cancelled = true; };
  }, []);

  // Who is already in which class, and how full each class is. Both come off
  // the one term-wide read -- a placed admission names its class, so nothing
  // further has to be asked.
  const { pairsOf, countOf } = useMemo(() => {
    // Every (student, class) pair, whatever became of it. A dropped admission
    // still names the class it was dropped from, so putting the student back
    // in has to be a change to that row rather than a second one.
    const pairsOf = new Map<string, Set<string>>();
    // Seats taken, per class.
    const countOf = new Map<string, number>();
    for (const e of admissionsRaw ?? []) {
      const studentId = refId(e[A.student]);
      const classId = refId(e[A.class]);
      if (!studentId || !classId) continue;
      let seen = pairsOf.get(studentId);
      if (!seen) pairsOf.set(studentId, (seen = new Set()));
      seen.add(classId);
      if (holdsPlace(str(e[A.stage]))) {
        countOf.set(classId, (countOf.get(classId) ?? 0) + 1);
      }
    }
    return { pairsOf, countOf };
  }, [admissionsRaw]);

  const shownClasses = useMemo(() => {
    const q = classQuery.trim().toLowerCase();
    return classes.filter((k) => {
      if (!q) return true;
      return `${str(k[C.name])} ${str(k[C.class_code])} ${str(k[C.room])}`
        .toLowerCase()
        .includes(q);
    });
  }, [classes, classQuery]);

  /**
   * The classes on screen, in shift order.
   *
   * Flat and alphabetical, the two sections of a course sat next to each other
   * -- ACC101-A and ACC101-B, one a morning class and one an evening one --
   * and the whole grid read as one undifferentiated list in which the thing
   * that actually separates a card from its neighbour was a chip halfway down
   * it. Grouping puts the shift where it is read once, as a heading, instead
   * of once per card.
   *
   * Within a shift the order is by start time, then by name: the grid then
   * runs down the day the way a timetable does, rather than alphabetically
   * through classes that happen to share a shift.
   *
   * A class with no start time has no shift. It gets its own group at the end
   * rather than being dropped or filed under a guess -- it is a class that
   * cannot be scheduled, which is worth seeing, not hiding.
   */
  const classGroups = useMemo(() => {
    const by = new Map<string, RawRecord[]>();
    for (const k of shownClasses) {
      const shift = shiftOf(str(k[C.start_time]));
      const list = by.get(shift);
      if (list) list.push(k);
      else by.set(shift, [k]);
    }
    // The window is spelled out rather than left to be inferred from the
    // cards: 13:00 is a house rule, not something a reader can derive from
    // seeing an 11:00 class above and a 14:00 one below.
    const meta = {
      Morning: { label: 'Morning', note: 'starts before 13:00', icon: 'sun' },
      Evening: { label: 'Evening', note: 'starts 13:00 or later', icon: 'moon' },
      '': { label: 'No time set', note: 'cannot be scheduled', icon: 'alert' },
    } as const;
    return (['Morning', 'Evening', ''] as const)
      .filter((shift) => (by.get(shift)?.length ?? 0) > 0)
      .map((shift) => ({
        shift,
        ...meta[shift],
        classes: [...(by.get(shift) ?? [])].sort(
          (a, b) =>
            str(a[C.start_time]).padStart(5, '0').localeCompare(
              str(b[C.start_time]).padStart(5, '0'),
            ) || str(a[C.name]).localeCompare(str(b[C.name])),
        ),
      }));
  }, [shownClasses]);

  /** Staged placements per class, for the card to list and count. */
  const stagedOf = useMemo(() => {
    const m = new Map<string, Staged[]>();
    for (const row of staged) {
      const list = m.get(row.classId);
      if (list) list.push(row);
      else m.set(row.classId, [row]);
    }
    return m;
  }, [staged]);

  /** The admissions already staged. One admission can only be placed once --
   *  it has one class -- so its own id is the whole key. */
  const stagedPairs = useMemo(
    () => new Set(staged.map((row) => row.admissionId)),
    [staged],
  );

  const classesFiltered = shownClasses.length !== classes.length;

  /**
   * The cards on screen: the whole list, narrowed only by the search box.
   *
   * There used to be a "Hide N placed" filter here as well, counting the
   * classes each *student* held. On a list of students that was useful. On a
   * list of subjects it is wrong twice over: every card here is unplaced by
   * construction, so there is nothing for it to hide, and the test it applied
   * -- does this student hold any class -- would have hidden Anika's maths and
   * physics because her chemistry was placed. The work still to do was what it
   * took off the screen.
   */
  const eligiblePeople = useMemo(() => {
    const q = studentQuery.trim().toLowerCase();
    return (candidates ?? []).filter((c) => {
      if (!q) return true;
      return `${c.name} ${c.detail}`.toLowerCase().includes(q);
    });
  }, [candidates, studentQuery]);

  const shownPeople = eligiblePeople;

  /* Distinct people, not cards. Both lists hold one entry per admission, so
     counting their length counts subjects. */
  const peopleTotalCount = useMemo(
    () => new Set((candidates ?? []).map((c) => c.studentId)).size,
    [candidates],
  );
  const peopleShownCount = useMemo(
    () => new Set(shownPeople.map((c) => c.studentId)).size,
    [shownPeople],
  );

  const peopleNarrowed = shownPeople.length !== (candidates?.length ?? 0);


  /**
   * The class's people, split by whether they are still in it.
   *
   * A dropped admission is not gone -- that is the whole point of dropping
   * rather than un-placing -- so it is shown, separately, with its reason. The
   * seat counts elsewhere on the board keep counting placed only.
   */
  const openRoster = useMemo(() => {
    const empty = { active: [] as RosterRow[], dropped: [] as RosterRow[] };
    if (!openClass) return empty;
    const out = { active: [] as RosterRow[], dropped: [] as RosterRow[] };
    const seen = new Set<string>();
    for (const e of admissionsRaw ?? []) {
      if (refId(e[A.class]) !== openClass.id) continue;
      const stage = str(e[A.stage]);
      const studentId = refId(e[A.student]);
      if (!studentId) continue;
      const row: RosterRow = {
        admissionId: e.id,
        studentId,
        name: refName(e[A.student]) || '—',
        grade: str(e[A.final_grade]),
        droppedOn: str(e[A.dropped_on]),
        dropReason: str(e[A.drop_reason]),
      };
      if (holdsPlace(stage)) {
        // One row per student: a duplicate pair would otherwise be counted
        // twice against the seats.
        if (seen.has(studentId)) continue;
        seen.add(studentId);
        out.active.push(row);
      } else if (stage === 'Dropped') {
        out.dropped.push(row);
      }
    }
    const byName = (a: RosterRow, b: RosterRow) => a.name.localeCompare(b.name);
    out.active.sort(byName);
    out.dropped.sort(byName);
    return out;
  }, [openClass, admissionsRaw]);

  /**
   * Takes a student back out of a class, leaving them admitted to the subject.
   *
   * Not a delete. The row records that they are entitled to sit this course,
   * which is still true -- only the question of which run of it has been
   * unanswered. They reappear on the left panel as a card waiting to be
   * placed, which is exactly where they were before the mistake.
   */
  const removeEnrollment = useCallback(
    async (admissionId: string, name: string) => {
      try {
        await unplaceAdmission(admissionId);
        // Patched locally rather than re-read: the term-wide read lags a
        // write, and every count on the board derives from this list.
        setAdmissionsRaw((prev) =>
          (prev ?? []).map((e) =>
            e.id === admissionId
              ? { ...e, [A.class]: null, [A.stage]: 'Admitted', [A.placed_on]: null }
              : e,
          ),
        );
        setToast({ tone: 'positive', message: `${name} taken out of this class.` });
      } catch (err) {
        setToast({ tone: 'warn', message: describeError(err) });
      }
    },
    [],
  );

  const dropStudent = useCallback(
    async (admissionId: string, name: string, reason: string) => {
      try {
        await dropAdmission(admissionId, reason);
        setAdmissionsRaw((prev) =>
          (prev ?? []).map((e) =>
            e.id === admissionId
              ? {
                  ...e,
                  [A.stage]: 'Dropped',
                  [A.dropped_on]: orgToday(),
                  [A.drop_reason]: reason,
                }
              : e,
          ),
        );
        setToast({ tone: 'positive', message: `${name} dropped from this course.` });
      } catch (err) {
        setToast({ tone: 'warn', message: describeError(err) });
      }
    },
    [],
  );

  /**
   * Put the selection on a class. Nothing is written.
   *
   * Every reason a placement cannot be made is checked here rather than at
   * Save, so the answer arrives while the student is still in your hand. Save
   * re-checks the one thing that can change underneath you -- somebody else
   * enrolling the same student -- against a fresh read.
   *
   * The rule that matters is the course. A card is an admission to one
   * subject, so it can only go into a class that runs that subject --
   * dropping "Adnan / Biology 101" onto a maths class is not a judgement call,
   * it is a mistake, and the card itself carries everything needed to say so.
   */
  const stage = useCallback(
    (klass: RawRecord) => {
      if (selected.length === 0) return;
      const classLabel = str(klass[C.class_code], str(klass[C.name], klass.id));

      const classCourse = refId(klass[C.course]) ?? '';
      const add: Staged[] = [];
      let already = 0;
      let wrongCourse = 0;
      let dup = 0;

      for (const who of selected) {
        if (who.courseId !== classCourse) {
          wrongCourse += 1;
          continue;
        }
        if (pairsOf.get(who.studentId)?.has(klass.id)) {
          already += 1;
          continue;
        }
        if (stagedPairs.has(who.admissionId)) {
          dup += 1;
          continue;
        }
        add.push({
          admissionId: who.admissionId,
          classId: klass.id,
          classLabel,
          studentId: who.studentId,
          name: who.name,
          courseName: who.courseName,
        });
      }

      if (add.length > 0) {
        setStaged((prev) => [...prev, ...add]);
        // What was placed leaves the selection. A card is one admission to one
        // subject, so once it has a class there is nowhere else for it to go
        // -- keeping it selected would leave a tick on a row that is no longer
        // in the list. Whatever was refused stays held, which is what makes a
        // mixed drop recoverable: drop again on a class that will take it.
        const done = new Set(add.map((row) => row.admissionId));
        setSelected((prev) => prev.filter((c) => !done.has(c.admissionId)));
      }

      const notes = [
        already > 0 ? already + ' already in it' : '',
        dup > 0 ? dup + ' already added' : '',
        wrongCourse > 0 ? wrongCourse + ' admitted to a different course' : '',
      ].filter(Boolean);

      setAnnouncement(
        add.length > 0
          ? add.length + ' added to ' + classLabel + '. Not saved yet.'
          : 'Nothing added to ' + classLabel + '.',
      );
      if (notes.length > 0 || add.length === 0) {
        setToast({
          tone: add.length > 0 ? 'positive' : 'warn',
          message:
            (add.length > 0
              ? add.length + ' added to ' + classLabel
              : 'Nothing to add to ' + classLabel) +
            (notes.length > 0 ? ' \u00b7 skipped ' + notes.join(', ') : '.'),
        });
      }
    },
    [selected, pairsOf, stagedPairs],
  );

  /** Take one staged placement back off a card. */
  const unstage = useCallback((admissionId: string) => {
    setStaged((prev) => prev.filter((row) => row.admissionId !== admissionId));
  }, []);

  /**
   * Write every staged placement.
   *
   * Grouped by class because the duplicate guard is a per-class read: one
   * request per class touched, not one per placement.
   *
   * What landed, and what turned out to be in the class already, leaves the
   * staging area. What failed stays, so pressing Save again retries exactly
   * the remainder instead of re-sending rows that already worked.
   */
  const commit = useCallback(async () => {
    if (staged.length === 0 || saving) return;
    setSaving(true);
    setError(null);

    const byClass = new Map<string, Staged[]>();
    for (const row of staged) {
      const list = byClass.get(row.classId);
      if (list) list.push(row);
      else byClass.set(row.classId, [row]);
    }

    const settled = new Set<string>();
    const placed: { admissionId: string; classId: string; classLabel: string }[] = [];
    const failed: { studentLabel: string; reason: string }[] = [];
    let alreadyThere = 0;

    try {
      for (const [classId, group] of byClass) {
        const classLabel = group[0]?.classLabel ?? classId;

        // Through the relationship, so it sees rows written moments ago.
        // Nothing server-side enforces one place per student per class.
        const existing = await getAdmissionsForClass(classId, false);
        const already = new Set(
          existing.map((r) => refId(r[A.student])).filter((id): id is string => Boolean(id)),
        );

        const rows: Placement[] = [];
        for (const row of group) {
          if (already.has(row.studentId)) {
            alreadyThere += 1;
            settled.add(row.admissionId);
            continue;
          }
          rows.push({
            admissionId: row.admissionId,
            classId,
            studentLabel: row.name,
            classLabel,
          });
        }

        const batch = await placeAdmissionBatch(rows);
        for (const row of batch.ok) {
          settled.add(row.admissionId);
          placed.push({ admissionId: row.admissionId, classId, classLabel });
        }
        failed.push(...batch.failed);
      }

      if (placed.length > 0) {
        // Patched, not re-read -- the term-wide read would not show these yet,
        // and every count on the board derives from this list.
        const byId = new Map(placed.map((row) => [row.admissionId, row]));
        setAdmissionsRaw((prev) =>
          (prev ?? []).map((rec) => {
            const hit = byId.get(rec.id);
            return hit
              ? {
                  ...rec,
                  [A.class]: { id: hit.classId, name: hit.classLabel },
                  [A.stage]: 'Placed',
                  [A.placed_on]: orgToday(),
                }
              : rec;
          }),
        );
      }
      setStaged((prev) => prev.filter((row) => !settled.has(row.admissionId)));
      if (settled.size > 0) setSelected([]);

      const notes = [
        alreadyThere > 0 ? alreadyThere + ' already in it' : '',
        failed.length > 0 ? failed.length + ' rejected' : '',
      ].filter(Boolean);

      setToast({
        tone: failed.length > 0 ? 'warn' : 'positive',
        message:
          placed.length +
          ' placed across ' +
          byClass.size +
          ' class' +
          (byClass.size === 1 ? '' : 'es') +
          (notes.length > 0 ? ' \u00b7 ' + notes.join(', ') : '.'),
      });

      if (failed.length > 0) {
        setError(failed.map((f) => f.studentLabel + ': ' + f.reason).join('; '));
      }
    } catch (err) {
      setError(describeError(err));
      setToast({ tone: 'warn', message: 'Nothing further was saved.' });
    } finally {
      setSaving(false);
    }
  }, [staged, saving]);


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

      {/* Everything placed but not written, and the one control that writes
          it -- portalled up into the page toolbar, beside the term picker and
          the view switch.

          It used to float, fixed to the bottom of the window, because the
          board ran past the fold and a Save placed after it would have been
          below it for most of the work. The columns scroll inside themselves
          now, so the toolbar row is the one strip that is always on screen and
          never moves -- which is what the fixed bar was buying, without a pill
          hovering over the bottom row of cards. */}
      {staged.length > 0 && (
        <ToolbarEnd>
        <div className="save-bar" role="region" aria-label="Unsaved placements">
          <i className="save-bar-dot" aria-hidden="true" />
          <span className="save-bar-count">
            <strong>{staged.length}</strong> placement{staged.length === 1 ? '' : 's'} in{' '}
            {stagedOf.size} class{stagedOf.size === 1 ? '' : 'es'}, not saved
          </span>
          <Button variant="ghost" small disabled={saving} onClick={() => setStaged([])}>
            Discard
          </Button>
          <Button variant="primary" small disabled={saving} onClick={commit}>
            {saving ? 'Saving…' : 'Save to CRM'}
          </Button>
        </div>
        </ToolbarEnd>
      )}

      {openDrawer !== null && openDrawer.kind === 'student' && (
        <StudentDetails
          /* Keyed so that following one student from another's record remounts
             rather than reusing the panel -- without it the new id would land
             in a panel still showing the previous record's fetched state. */
          key={openDrawer.studentId}
          studentId={openDrawer.studentId}
          name={openDrawer.name}
          termLabel={termLabel}
          onOpenClass={(klass) => pushDrawer({ kind: 'class', klass })}
          onDropEnrolment={dropStudent}
          onClose={popDrawer}
        />
      )}

      {openDrawer !== null && openDrawer.kind === 'class' && (
        <ClassDetails
          key={openDrawer.klass.id}
          klass={openDrawer.klass}
          hasMet={classesMet.has(openDrawer.klass.id)}
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
            {/* People, then cards. The count said 23 over a column of 23 cards
                belonging to 8 students, because a card is one admission -- one
                student, one subject -- and a student taking three subjects is
                three of them. "Students 23" was a claim about the intake and
                it was wrong by a factor of three.

                Both numbers, because both are asked: how many people are
                waiting, and how much work is in the column. The filter counts
                cards, since that is what it narrows. */}
            <span className="count">
              {peopleNarrowed
                ? `${peopleShownCount} of ${peopleTotalCount}`
                : peopleTotalCount}
            </span>
            <span className="count-sub">
              {peopleNarrowed
                ? `${shownPeople.length} of ${candidates?.length ?? 0} cards`
                : `${candidates?.length ?? 0} card${(candidates?.length ?? 0) === 1 ? '' : 's'}`}
            </span>
          </h2>

          {/* One button, both directions.

              Two of them meant one was always disabled -- Clear with nothing
              held, Select all with everything -- so half the control was dead
              at any moment, and the live half moved between them. The state
              decides the label instead, the way a header checkbox does.

              Anything held, not everything: with three of twenty-three ticked
              the useful offer is to drop them, and finishing the set is one
              more click on a card. */}
          {!peopleLoading && shownPeople.length > 0 && (
            <Button
              small
              className="board-tools-end"
              onClick={() =>
                setSelected(selected.length > 0 ? [] : shownPeople)
              }
            >
              {selected.length > 0
                ? `Unselect all ${selected.length}`
                : `Select all ${shownPeople.length}`}
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


        {peopleLoading && showPeopleSpinner && <Loader label="Loading students…" />}

        {!peopleLoading && candidates?.length === 0 && (
          <EmptyState
            icon="users"
            title="Nobody to place"
            detail="Every subject admitted for this term already has a class. A student appears here once their fee is settled and their courses are recorded in Admissions."
          />
        )}

        {!peopleLoading && (candidates?.length ?? 0) > 0 && shownPeople.length === 0 && (
          <EmptyState
            icon="users"
            title="No match"
            detail={`No student here matches “${studentQuery}”.`}
          >
            <Button small onClick={() => setStudentQuery('')}>
              Clear search
            </Button>
          </EmptyState>
        )}

        {!peopleLoading && shownPeople.length > 0 && (
          <>
            <StudentList
              people={shownPeople}
              selectedIds={selectedIds}
              disabled={saving}
              onToggle={(who) => {
                toggle(who);
                // Whatever went wrong last time was about the last attempt.
                setError(null);
                setAnnouncement(
                  selectedIds.has(who.admissionId)
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

        {/* How much of the list the filter is showing. One line, and only
            while it is narrowing something -- the full count is in the
            heading. */}
        {!loading && classesFiltered && shownClasses.length > 0 && (
          <p className="muted board-count">
            {shownClasses.length} of {classes.length}
          </p>
        )}

        {error && <Banner tone="error">{error}</Banner>}

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
                : 'Nothing is scheduled to teach in this term yet.'
            }
          >
            {classQuery.trim() !== '' && (
              <Button small onClick={() => setClassQuery('')}>
                Clear search
              </Button>
            )}
          </EmptyState>
        )}

        {/* The classes scroll inside the column, the way the roll already did
            on the other side. A term with eighteen classes made the column
            taller than the window, which scrolled the whole page -- taking the
            student roll, both headings and the term picker off the top, so a
            drag had to be aimed at a class while the thing being dragged was
            somewhere above the fold. */}
        <div className="class-scroll" ref={classScroll}>
        {!loading && classGroups.map((group) => (
          <section key={group.shift} className={`shift-group shift-${group.shift || 'none'}`}>
            <h4 className="shift-head">
              <Icon name={group.icon} size={15} />
              <span className="shift-name">{group.label}</span>
              <span className="shift-count">{group.classes.length}</span>
              <span className="shift-note">{group.note}</span>
            </h4>
            <div className="class-grid">
            {group.classes.map((k) => (
          <ClassDrop
            key={k.id}
            klass={k}
            hasMet={classesMet.has(k.id)}
            seats={countOf.get(k.id) ?? 0}
            selected={selected}
            /* Why each held card cannot go in, counted once each. They have to
               be one split of the selection rather than three separate tests:
               a card can be both the wrong subject AND its student already
               staged here, and counting it twice drove `placeable` negative,
               which read as "placeable" and put the Add button back on a class
               that was refusing the drop. First reason wins. */
            {...(() => {
              const classCourse = refId(k[C.course]) ?? '';
              const stagedHere = new Set(
                (stagedOf.get(k.id) ?? []).map((row) => row.admissionId),
              );
              let wrongCourse = 0;
              let alreadyIn = 0;
              let alreadyStaged = 0;
              for (const c of selected) {
                if (c.courseId !== classCourse) wrongCourse += 1;
                else if (pairsOf.get(c.studentId)?.has(k.id)) alreadyIn += 1;
                else if (stagedHere.has(c.admissionId)) alreadyStaged += 1;
              }
              return { wrongCourse, alreadyIn, alreadyStaged };
            })()}
            staged={stagedOf.get(k.id) ?? []}
            disabled={saving}
            dragOver={dragOver === k.id}
            onDragOver={setDragOver}
            onAdd={stage}
            onRemoveStaged={unstage}
            onOpen={(klass) => pushDrawer({ kind: 'class', klass })}
          />
            ))}
            </div>
          </section>
        ))}
        </div>
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
  hasMet,
  roster,
  dropped,
  onRemove,
  onDrop,
  onOpenStudent,
  onClose,
}: {
  klass: RawRecord;
  /** Has a register been taken against a past lesson of this class? */
  hasMet: boolean;
  /**
   * The roster as the board already knows it, or null when this class is not
   * in the term on screen -- a class opened from a student's record can be
   * from any term, and the board only holds the current one. Null means fetch.
   */
  roster: RosterRow[] | null;
  /** Enrolments that ended early. Shown, not hidden -- see openRoster. */
  dropped: RosterRow[];
  onRemove: (admissionId: string, name: string) => Promise<void>;
  onDrop: (admissionId: string, name: string, reason: string) => Promise<void>;
  onOpenStudent: (who: { studentId: string; name: string }) => void;
  onClose: () => void;
}) {
  // Only used when `roster` is null: the class belongs to another term, so
  // its roster has to be read rather than derived from what is on screen.
  const [ownRoster, setOwnRoster] = useState<RosterRow[] | null>(null);

  useEffect(() => {
    if (roster !== null) { setOwnRoster(null); return; }
    let cancelled = false;
    getAdmissionsForClass(klass.id, false)
      .then((recs) => {
        if (cancelled) return;
        setOwnRoster(
          recs
            .filter((e) => holdsPlace(str(e[A.stage])))
            .map((e) => ({
              admissionId: e.id,
              studentId: refId(e[A.student]) ?? '',
              name: refName(e[A.student]) || '—',
              grade: str(e[A.final_grade]),
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
  const status = classTone(effectiveClassStatus(str(klass[C.status]), hasMet));

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
          {(sessions ?? 0) === 0 ? (
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
              const st = stats?.get(r.admissionId);
              const marks = st?.marks ?? 0;
              const rate = attendanceRate(st);
              const mode = acting?.id === r.admissionId ? acting.mode : null;
              return (
                <li key={r.admissionId}>
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
                          setWorking(r.admissionId);
                          await onDrop(r.admissionId, r.name, reason.trim());
                          setWorking(null);
                          setActing(null);
                          setReason('');
                        }}
                      >
                        {working === r.admissionId ? 'Dropping…' : 'Drop'}
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
                          setWorking(r.admissionId);
                          await onRemove(r.admissionId, r.name);
                          setWorking(null);
                          setActing(null);
                        }}
                      >
                        {working === r.admissionId ? 'Removing…' : 'Remove'}
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
                        onClick={() => { setActing({ id: r.admissionId, mode: 'drop' }); setReason(''); }}
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
                          onClick={() => setActing({ id: r.admissionId, mode: 'remove' })}
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
              <li key={r.admissionId} className="roster-past">
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
  hasMet,
  seats,
  selected,
  alreadyIn,
  wrongCourse,
  alreadyStaged,
  staged,
  disabled,
  dragOver,
  onDragOver,
  onAdd,
  onRemoveStaged,
  onOpen,
}: {
  klass: RawRecord;
  /** Has a register been taken against a past lesson of this class? */
  hasMet: boolean;
  seats: number;
  selected: Candidate[];
  /** Why each held card cannot go in, as one disjoint split of the selection:
   *  whichever reason comes first is the only one it is counted under, so the
   *  three always sum to at most `selected.length`. */
  alreadyIn: number;
  wrongCourse: number;
  alreadyStaged: number;
  /** Placed here but not written yet. Listed on the card so the board shows
   *  the term as it will be, with a way to take each one back. */
  staged: Staged[];
  disabled: boolean;
  dragOver: boolean;
  onDragOver: (id: string | null) => void;
  onAdd: (klass: RawRecord) => void;
  /** Takes one staged placement back off. Keyed on the admission, which is
   *  the identity of the card -- a (class, student) pair would not be, since
   *  the same student can hold several subjects. */
  onRemoveStaged: (admissionId: string) => void;
  onOpen: (klass: RawRecord) => void;
}) {
  const capacity = int(klass[C.capacity]);
  const days = strList(klass[C.meeting_days]);
  const effectiveStatus = effectiveClassStatus(str(klass[C.status]), hasMet);
  const status = classTone(effectiveStatus);
  // Capacity counts what the class will hold once saved, not what it holds
  // now: filling the last seat twice over before pressing Save is exactly the
  // mistake staging is supposed to make visible.
  const taken = seats + staged.length;
  const full = capacity !== null && taken >= capacity;
  // A class with no lessons generated cannot have a register taken against
  // it, so students placed here have nowhere to be marked present. Worth
  // seeing before the placement, not after.
  const sessions = int(klass[C.sessions_count]);
  // A class accepts a drop whenever anything is selected: whoever cannot go
  // in -- already enrolled, no application -- is reported per student after
  // the attempt rather than blocking the whole set.
  // The three reasons are a split of the selection, so this cannot go
  // negative -- which it did when they were counted separately, and a
  // negative count is not zero, so the card offered a drop it would refuse.
  const placeable = selected.length - alreadyIn - alreadyStaged - wrongCourse;
  // placeable, not just "something is selected". A card that cannot take any
  // of what is held still called preventDefault on dragover, which is what
  // tells the browser a drop is allowed: the cursor said copy, the card lit up
  // as a target, and the drop landed on a card already saying in words that
  // the student is not admitted to its course -- answered with a toast listing
  // the reason it had been showing all along. Refusing the dragover instead
  // puts a no-drop cursor on it and never fires the drop at all.
  const droppable = selected.length > 0 && !disabled && placeable > 0;
  const time = [str(klass[C.start_time]), str(klass[C.end_time])].filter(Boolean).join('–');

  return (
    <div
      className={[
        'drop-card',
        staged.length > 0 ? 'has-staged' : '',
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
        if (droppable) onAdd(klass);
      }}
    >
      {/* A real button, and outside the action row below -- buttons cannot
          nest, and the Enrol button lives there. */}
      <button type="button" className="drop-card-main" onClick={() => onOpen(klass)}>
        <div className="cell-lines">
          <div className="cell-title">{str(klass[C.name])}</div>
          <div
            className="cell-sub"
            title={[
              days.length > 0 ? shortDays(days) : 'No days set',
              time,
              str(klass[C.room]),
            ].filter(Boolean).join(' · ')}
          >
            {days.length > 0 ? shortDays(days) : 'No days set'}
            {time && <> · {time}</>}
            {str(klass[C.room]) && <> · {str(klass[C.room])}</>}
          </div>
        </div>
      </button>

      <div className="drop-card-side">
        <Chip
          title={
            staged.length > 0
              ? `${seats} enrolled, ${staged.length} waiting to be saved`
              : `${seats} enrolled`
          }
        >
          {/* No icon. Two numbers over a slash in the one place on the card
              where a count belongs are not ambiguous, and the glyph cost more
              width than it explained. The tooltip says it in words. */}
          {seats}
          {staged.length > 0 && <span className="seats-staged">+{staged.length}</span>}
          {capacity !== null && ` / ${capacity}`}
        </Chip>
        {/* The lesson count has gone; only its one actionable case is left.
            A class with no lessons cannot have a register taken against it, so
            anyone placed there has nowhere to be marked present -- worth
            seeing before the drop. Knowing it has twenty-seven rather than
            twenty-six never changed a decision on this screen. */}
        {/* null, not just 0. A class that never had sessions has no rollup
            value at all -- Sessions_Count comes back empty, and `=== 0` only
            ever caught a class whose sessions had been counted down to zero.
            The warning was invisible on exactly the class it is for: a new
            one nobody has generated lessons for. */}
        {/* "yet", and it is the whole word. Beside a status of Scheduled,
            "No lessons" read as a contradiction -- the card names the days and
            the time right above it, so something is plainly scheduled. The two
            badges answer different questions: the status is the stage someone
            set on the class in the CRM, this is whether the dated lessons have
            been generated from its weekly rule. Nobody has run the generator
            is a different statement from there are none, and one word is the
            difference. Worded as the staffing view already words it. */}
        {(sessions ?? 0) === 0 && (
          <Badge
            tone="critical"
            dot
            title="This class has a weekly pattern but no dated lessons have been generated from it yet, so no register can be taken against it."
          >
            No lessons yet
          </Badge>
        )}
        {full && <Badge tone="pending" dot>Full</Badge>}
        {/* Only when it is not the ordinary case. Every class in a running
            term reads Running, so the badge said nothing on sixteen cards and
            hid the one that was Cancelled among them. */}
        {/* Only the statuses that should give you pause before dropping a
            student here.

            It used to be "anything but Running", read off the stored field --
            which, since nobody advances that field, meant most of a term's
            classes carried a Scheduled badge saying only that somebody had
            not been into the CRM lately. Deriving the status fixed the
            meaning but not the noise: a class that has met now reads Running
            on every card, and Running is the ordinary case, so it says
            nothing at all.

            Cancelled, Draft and Completed are the three that change the
            answer: the class is off, not confirmed yet, or already over.
            Running and Scheduled both mean "this class is fine", and the
            difference between them is a question for the register rather than
            for the board. The drawer still shows the status in full. */}
        {(effectiveStatus === 'Cancelled' ||
          effectiveStatus === 'Draft' ||
          effectiveStatus === 'Completed') && (
          <Badge tone={status.tone} dot>{status.label}</Badge>
        )}
      </div>

      {/* Only while a student is held. A button on every class at all times
          would read as the card's primary action, which it is not. */}
      {selected.length > 0 && (
        <div className="drop-card-action">
          {placeable === 0 ? (
            /* Say which of the reasons it is. "Already in this class" on
               somebody only staged -- or on somebody who simply takes a
               different subject -- sends them looking for a placement that
               was never made. Wrong course first: it is the one that is about
               the class rather than about the student. */
            wrongCourse > 0 && alreadyIn === 0 && alreadyStaged === 0 ? (
              <span className="muted cover-mark">
                <Icon name="alert" size={14} />
                {selected.length === 1
                  ? `Not admitted to ${refName(klass[C.course]) || 'this course'}`
                  : 'Admitted to other courses'}
              </span>
            ) : alreadyStaged > 0 && alreadyIn === 0 ? (
              <span className="muted cover-mark">
                <Icon name="check" size={14} />
                {selected.length === 1 ? 'Already added' : 'All already added'}
              </span>
            ) : (
              <span className="muted cover-mark">
                <Icon name="check" size={14} />
                {selected.length === 1 ? 'Already in this class' : 'All already in this class'}
              </span>
            )
          ) : (
            <Button
              variant={full ? 'default' : 'primary'}
              small
              disabled={disabled}
              onClick={() => onAdd(klass)}
            >
              {selected.length === 1
                ? `Add ${selected[0]?.name}${full ? ' anyway' : ''}`
                : `Add ${placeable}${full ? ' anyway' : ''}`}
            </Button>
          )}
          {placeable > 0 && (alreadyIn > 0 || wrongCourse > 0) && (
            <span className="muted cell-sub">
              {[
                alreadyIn > 0 ? `${alreadyIn} already in` : '',
                wrongCourse > 0 ? `${wrongCourse} other course` : '',
              ].filter(Boolean).join(' · ')}
            </span>
          )}
        </div>
      )}
      {/* Who is waiting to be saved into this class. Named, not counted: the
          point of staging is to read back what you have built before it is
          written, and "3 added" cannot be checked. */}
      {staged.length > 0 && (
        <div className="staged-strip">
          <span className="staged-head">
            Adding on save · {staged.length}
          </span>
          <ul className="staged-list">
            {staged.map((row) => (
              <li key={row.studentId}>
                <span className="staged-name">{row.name}</span>
                <button
                  type="button"
                  className="staged-remove"
                  title={'Remove ' + row.name + ' from this class'}
                  aria-label={'Remove ' + row.name + ' from ' + str(klass[C.name])}
                  disabled={disabled}
                  onClick={() => onRemoveStaged(row.admissionId)}
                >
                  <Icon name="close" size={12} />
                </button>
              </li>
            ))}
          </ul>
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
  selectedIds,
  disabled,
  onToggle,
  onOpenStudent,
}: {
  people: Candidate[];
  /** Classes each student holds within the current view; absent means none. */
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
          <div key={c.admissionId} className="board-row" style={{ top: (first + i) * ROW_H }}>
            <PersonCard
              person={c}
              selected={selectedIds.has(c.admissionId)}
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
 * Scrolls a container while a drag is held near its top or bottom edge.
 *
 * A drag owns the pointer: the wheel still works in most browsers but the
 * scrollbar does not, and with eighteen classes in a term the one you are
 * aiming at is routinely below the fold. Without this the only way to reach it
 * is to drop the card somewhere harmless, scroll, and pick it up again.
 *
 * Driven from a document-level dragover rather than one on the container.
 * dragover on the element itself stops firing the moment the pointer leaves
 * it, which leaves the last speed in place and the column scrolling on its own
 * for the rest of the drag; testing the pointer against the element's box
 * means leaving it simply reads as zero.
 *
 * Speed ramps with depth into the edge zone instead of being a fixed step, so
 * the same gesture gives a nudge near the boundary and a fast run at the very
 * edge -- a fixed step is either too slow to cross a long column or too fast
 * to stop on a card.
 */
function useDragAutoScroll(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    /** How far into the element counts as the edge, and the cap in px/frame. */
    const ZONE = 88;
    const MAX = 16;

    let speed = 0;
    let frame = 0;

    const step = () => {
      const el = ref.current;
      if (!el || speed === 0) {
        frame = 0;
        return;
      }
      el.scrollTop += speed;
      frame = requestAnimationFrame(step);
    };

    const onDragOver = (e: DragEvent) => {
      const el = ref.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      // Half the height at most, or on a short column the two zones overlap
      // and the whole thing scrolls wherever the pointer is.
      const zone = Math.min(ZONE, box.height / 2 - 1);
      const inside =
        e.clientX >= box.left && e.clientX <= box.right &&
        e.clientY >= box.top && e.clientY <= box.bottom;

      if (!inside || zone <= 0) {
        speed = 0;
        return;
      }

      const fromTop = e.clientY - box.top;
      const fromBottom = box.bottom - e.clientY;
      if (fromTop < zone) speed = -MAX * (1 - fromTop / zone);
      else if (fromBottom < zone) speed = MAX * (1 - fromBottom / zone);
      else speed = 0;

      if (speed !== 0 && frame === 0) frame = requestAnimationFrame(step);
    };

    const stop = () => {
      speed = 0;
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = 0;
    };

    document.addEventListener('dragover', onDragOver);
    // Both, because a drop fires drop and dragend fires on a cancelled one.
    document.addEventListener('drop', stop);
    document.addEventListener('dragend', stop);
    return () => {
      stop();
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('drop', stop);
      document.removeEventListener('dragend', stop);
    };
  }, [ref]);
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
  selected,
  selectedCount,
  disabled,
  onToggle,
  onOpenStudent,
}: {
  person: Candidate;
  selected: boolean;
  /** Size of the whole selection, for the drag image. */
  selectedCount: number;
  disabled: boolean;
  onToggle: (who: Candidate) => void;
  onOpenStudent: (who: { studentId: string; name: string }) => void;
}) {
  return (
    <div
      className={`pick-row${selected ? ' is-picked' : ''}`}
      /* One student is one colour, on every card they hold. A student taking
         five subjects is five cards here, and read as a plain list they are
         five strangers with the same name -- you count down the names to see
         whether somebody has been missed. The stripe makes a person a block
         you can see the edges of without reading anything.

         The same hue the avatar uses, from the same name, so the person in
         the record panel and the person on the board are visibly one person.
         Inline because it is data, not design: there is no stylesheet rule
         that could know it. */
      /* Stronger than the avatar wears it. The avatar is a filled circle 28px
         across carrying white text, so it has to stay dark; the stripe is 6px
         of pure colour against white and can afford to be vivid. Same hue, so
         they still read as one person. */
      style={{ ['--person' as string]: `hsl(${hueOf(person.name)} 72% 47%)` } as CSSProperties}
    >
    {/* A real checkbox, outside the draggable area. Selecting and dragging
        were the same gesture on the same element before, which is why one
        kept stealing the other. Keyboard users select here; it is also what
        makes the selection reachable without a pointer at all. */}
    <input
      type="checkbox"
      className="pick-check"
      checked={selected}
      disabled={disabled}
      aria-label={`Select ${person.name} for ${person.courseName}`}
      onChange={() => onToggle(person)}
    />

    <div
      className="pick-card"
      draggable={!disabled}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'copy';
        // Some browsers cancel a drag that carries no payload at all.
        e.dataTransfer.setData('text/plain', person.studentId);
        // Dragging means "this one too": an unselected card joins the
        // selection, a selected one takes the whole set with it.
        //
        // Deferred, and that is the whole point. Selecting re-renders this row
        // -- the checkbox ticks, the row takes its picked styling -- and doing
        // that synchronously here replaces the element the browser is in the
        // middle of picking up, which silently cancels the drag. The card then
        // just looked clicked, and only a second drag worked, because by then
        // it was already selected and nothing re-rendered. A tick late is
        // still long before the drop.
        if (!selected) window.setTimeout(() => onToggle(person), 0);

        // Say how many are coming. The browser's default drag image is the one
        // card under the pointer, so dragging a set of five looked exactly
        // like dragging one -- the other four appeared to be left behind.
        const count = selected ? selectedCount : selectedCount + 1;
        if (count > 1) {
          const ghost = document.createElement('div');
          ghost.className = 'drag-ghost';
          ghost.textContent = `${count} placements`;
          document.body.appendChild(ghost);
          e.dataTransfer.setDragImage(ghost, 16, 16);
          // It has to be in the document when the image is taken, and gone
          // immediately after, or it sits on the page for the whole drag.
          window.setTimeout(() => ghost.remove(), 0);
        }
      }}
    >
      <span className="cell-lines">
        {/* Name and id share a line: they answer one question -- who -- and
            the id is short enough to ride along. The subject gets the line
            below to itself, because it is what decides where the card may go. */}
        <span className="pick-head">
          <span className="cell-title">{person.name}</span>
          {person.detail && <span className="pick-id">{person.detail}</span>}
        </span>
        <span className="cell-sub pick-course">{person.courseName}</span>
      </span>
    </div>

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
  termLabel,
  onOpenClass,
  onDropEnrolment,
  onClose,
}: {
  studentId: string;
  name: string;
  termLabel: string;
  /** Opens a class from one of this student's rows. The board owns the class
   *  drawer, and the two panels cannot stack, so this closes the student. */
  onOpenClass: (klass: RawRecord) => void;
  /** Ends one of this student's placements. The board owns the write so its
   *  seat counts stay in step; the panel patches its own copy on success. */
  onDropEnrolment: (admissionId: string, name: string, reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [student, setStudent] = useState<RawRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const showSpinner = useDelayed(student === null && error === null);

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
    getAdmissionsForStudent(studentId)
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
    const ids = (taken ?? []).map((e) => refId(e[A.class]) ?? '').filter(Boolean);
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

  // Attendance per admission, to the same rule as the class drawer: Present or
  // Late over everything that is not Excused.
  const tallyOf = useMemo(() => {
    const tally = new Map<string, { present: number; eligible: number }>();
    for (const m of marks ?? []) {
      const id = refId(m[AT.admission]);
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
      const term = refName(e[A.term]) || 'No term recorded';
      let g = groups.get(term);
      if (!g) groups.set(term, (g = { term, rows: [] }));
      g.rows.push(e);
    }
    for (const g of groups.values()) {
      g.rows.sort((a, b) => refName(a[A.class]).localeCompare(refName(b[A.class])));
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
    // No fee total any more: the fee is charged once for the sign-up and sits
    // on the student, so a per-subject amount outstanding does not exist.
    const owed = 0;
    for (const e of rows) {
      const t = tallyOf.get(e.id);
      if (t) { present += t.present; eligible += t.eligible; }
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
                      const status = str(e[A.stage]);
                      const grade = str(e[A.final_grade]);
                      const klass = klasses.get(refId(e[A.class]) ?? '');
                      const days = klass ? strList(klass[C.meeting_days]) : [];
                      const time = klass
                        ? [str(klass[C.start_time]), str(klass[C.end_time])].filter(Boolean).join('–')
                        : '';
                      const rate = rateOf.get(e.id);
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
                                {refName(e[A.class]) || '—'}
                              </button>
                            ) : (
                              <span className="cell-title">{refName(e[A.class]) || '—'}</span>
                            )}
                            <span className="cell-sub">
                              {refName(e[A.course]) || 'No course recorded'}
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
                            </span>
                          </span>
                          {status !== 'Placed' ? (
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
                                aria-label={`Reason for leaving ${refName(e[A.class])}`}
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
                                        ? { ...r, [A.stage]: 'Dropped', [A.dropped_on]: orgToday() }
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
                              title={`${name} is leaving ${refName(e[A.class])}`}
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
          ) : type === 'date' ? (
            /* Its own branch so the day/month/year field is used wherever a
               date is edited, not only where one was written by hand. */
            <DateField
              className="field"
              autoFocus
              value={draft}
              disabled={saving}
              aria-label={label}
              onChange={setDraft}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); void commit(); }
                if (e.key === 'Escape') cancel();
              }}
            />
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
