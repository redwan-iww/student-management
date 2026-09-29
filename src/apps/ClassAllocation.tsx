import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader, ButtonBusy, useDelayed } from '../components/Loader';
import { Avatar, Badge, Banner, Button, Card, Chip, EmptyState, Icon } from '../components/ui';
import { allocationTone, classTone, shortDays } from '../components/status';
import { EnrollmentBoard } from '../components/EnrollmentBoard';
import {
  ZOHO_MODULES,
  ALLOCATION_ROLE_VALUES,
  type AllocationRole,
} from "../generated/types";
import {
  createAllocation,
  describeError,
  endAllocation,
  getActiveTerms,
  getAllocationsForClass,
  getClassesForTerm,
  getCourses,
  getSessionsForClass,
  getTeachers,
  int,
  orgToday,
  refId,
  refName,
  setPrimaryTeacher,
  str,
  strList,
  type RawRecord,
} from "../zoho/client";

const C = ZOHO_MODULES.classes.fields;
const T = ZOHO_MODULES.terms.fields;
const TE = ZOHO_MODULES.teachers.fields;
const AL = ZOHO_MODULES.allocations.fields;
const S = ZOHO_MODULES.class_sessions.fields;
const CO = ZOHO_MODULES.courses.fields;

/**
 * What one allocation covers.
 *
 * The schema has carried this distinction since the beginning -- an allocation
 * with class_session NULL covers the whole class, and one with it set is a
 * substitution on that single date -- but nothing could set it until now.
 */
type AllocationScope = 'class' | 'session';

/**
 * Which half of staffing the tab is showing.
 *
 * Teachers and students are the two sides of the same question -- who is in
 * this class -- and they share the term picker and the class list, so they
 * share a tab rather than being a second widget to register.
 */
type View = 'staffing' | 'enrollment';

/** Web-tab entry point for staffing: term → class → who teaches it. */
export function ClassAllocation() {
  const [terms, setTerms] = useState<RawRecord[] | null>(null);
  const [termId, setTermId] = useState<string>("");
  const [classes, setClasses] = useState<RawRecord[] | null>(null);
  const [teachers, setTeachers] = useState<RawRecord[]>([]);
  // The course catalogue, read once: it is how a class reaches its programme,
  // and it does not change when the term does.
  const [courses, setCourses] = useState<RawRecord[]>([]);
  // Which department's classes to show. Empty means all of them. Lives here
  // rather than in the board because it sits beside the term picker and
  // narrows both views.
  const [programId, setProgramId] = useState('');
  const [selectedClass, setSelectedClass] = useState<RawRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Active allocation count per class. The list showed only Primary_Teacher,
  // which tracks the lead role alone -- so a class staffed entirely by a
  // substitute read as "Unassigned", contradicting its own detail screen.
  const [staffCount, setStaffCount] = useState<Map<string, number>>(new Map());
  // Switching term keeps the previous list on screen and dims it, rather than
  // tearing the table down and rebuilding it.
  const [loadingClasses, setLoadingClasses] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getActiveTerms(), getTeachers(), getCourses()])
      .then(([ts, teach, cat]) => {
        if (cancelled) return;
        setTerms(ts);
        setTeachers(teach);
        setCourses(cat);
        if (ts[0]) setTermId(ts[0].id);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(describeError(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!termId) return;
    let cancelled = false;
    setLoadingClasses(true);
    setSelectedClass(null);
    setStaffCount(new Map());
    getClassesForTerm(termId)
      .then(async (cs) => {
        if (cancelled) return;
        // Render the table first; the staff column fills in a moment later.
        setClasses(cs);
        setLoadingClasses(false);

        const counts = await Promise.all(
          cs.map(async (k) => {
            try {
              const allocs = await getAllocationsForClass(k.id);
              return [k.id, allocs.filter((a) => a[AL.status] !== "Ended").length] as const;
            } catch {
              return [k.id, 0] as const;
            }
          }),
        );
        if (!cancelled) setStaffCount(new Map(counts));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(describeError(err));
        setLoadingClasses(false);
      });
    return () => {
      cancelled = true;
    };
  }, [termId]);

  const showClassSpinner = useDelayed(loadingClasses);
  const showTermsSpinner = useDelayed(terms === null);

  // Opens on students, not teachers: placing an intake is the bulk of the work
  // and the part done under time pressure, while staffing a class is a handful
  // of decisions made once a term.
  const [view, setView] = useState<View>('enrollment');

  const selectedId = selectedClass?.id ?? null;
  // Stable identity, and a no-op when the count has not moved. ClassStaffing's
  // refresh() depends on this callback and an effect depends on refresh, so an
  // inline arrow here would remake both on every parent render and loop:
  // fetch -> setStaffCount -> re-render -> fetch.
  const handleStaffChanged = useCallback(
    (activeCount: number) => {
      if (!selectedId) return;
      setStaffCount((prev) =>
        prev.get(selectedId) === activeCount
          ? prev
          : new Map(prev).set(selectedId, activeCount),
      );
    },
    [selectedId],
  );

  // NB: above the early returns below. These are hooks, and the guards that
  // follow return before the render on the first pass -- leaving them down
  // there means the hook count changes between renders, which React treats
  // as a torn component and unmounts. That is what blanked the tab.
  // Class -> programme, walked through the course: a class names its course
  // but not its department, and COQL cannot join those two hops. A class whose
  // course is missing from the catalogue keeps no programme rather than
  // disappearing -- it still has to be staffable.
  const { programOf, programs } = useMemo(() => {
    const programByCourse = new Map<string, { id: string; name: string }>();
    for (const course of courses) {
      const id = refId(course[CO.program]);
      const name = refName(course[CO.program]);
      if (id && name) programByCourse.set(course.id, { id, name });
    }

    const programOf = new Map<string, { id: string; name: string }>();
    const seen = new Map<string, string>();
    for (const k of classes ?? []) {
      const courseId = refId(k[C.course]);
      const program = courseId ? programByCourse.get(courseId) : undefined;
      if (program) {
        programOf.set(k.id, program);
        seen.set(program.id, program.name);
      }
    }

    return {
      programOf,
      programs: [...seen.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [classes, courses]);

  // Applied to the staffing table here and inside the board, so the one
  // picker narrows whichever view is open.
  const shownClasses = useMemo(
    () =>
      programId
        ? (classes ?? []).filter((k) => programOf.get(k.id)?.id === programId)
        : (classes ?? []),
    [classes, programId, programOf],
  );

  if (error) return <Banner tone="error">{error}</Banner>;
  if (terms === null) return showTermsSpinner ? <Loader label="Loading terms…" /> : null;
  if (terms.length === 0)
    return (
      <EmptyState
        icon="calendar"
        title="No open or running terms"
        detail="Staffing is organised by term, so there is nothing to allocate until one is open. Open a term in the Terms module."
      />
    );

  if (selectedClass) {
    return (
      <>
        <Button
          variant="ghost"
          className="back"
          onClick={() => setSelectedClass(null)}
        >
          <Icon name="arrow-left" />
          Back to classes
        </Button>
        <ClassStaffing
          klass={selectedClass}
          teachers={teachers}
          onPrimaryChanged={(teacherId) => {
            const ref = pickRef(teachers, teacherId);
            setSelectedClass({ ...selectedClass, [C.primary_teacher]: ref });
            // Keep the list in step, or "Back to classes" shows the teacher
            // that was just changed.
            setClasses((prev) =>
              prev?.map((k) =>
                k.id === selectedClass.id ? { ...k, [C.primary_teacher]: ref } : k,
              ) ?? prev,
            );
          }}
          onStaffChanged={handleStaffChanged}
        />
      </>
    );
  }

  const selectedTerm = terms.find((t) => t.id === termId);

  return (
    <section>
      <div className="toolbar toolbar-page">
        <label>
          <span className="bulk-label">Term</span>
          <select value={termId} onChange={(e) => setTermId(e.target.value)}>
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {str(t[T.name], t.id)}
              </option>
            ))}
          </select>
        </label>

        {/* Beside the term, because the two answer the same question: which
            slice of the timetable am I looking at. Hidden when the term's
            classes all sit in one department and there is nothing to choose. */}
        {programs.length > 1 && (
          <label>
            <span className="bulk-label">Programme</span>
            <select value={programId} onChange={(e) => setProgramId(e.target.value)}>
              <option value="">All programmes</option>
              {programs.map((pr) => (
                <option key={pr.id} value={pr.id}>
                  {pr.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="seg">
          <Button
            className={view === 'staffing' ? 'is-on' : undefined}
            aria-pressed={view === 'staffing'}
            onClick={() => setView('staffing')}
          >
            <Icon name="user" size={14} />
            Teachers
          </Button>
          <Button
            className={view === 'enrollment' ? 'is-on' : undefined}
            aria-pressed={view === 'enrollment'}
            onClick={() => setView('enrollment')}
          >
            <Icon name="users" size={14} />
            Students
          </Button>
        </div>
      </div>

      {/* The board is given the class list rather than fetching its own, so it
          waits for the same load the staffing table does -- handing it an
          empty array early would render "no classes" over a term that has
          plenty. */}
      {view === 'enrollment' && selectedTerm && (
        classes === null ? (
          showClassSpinner ? <Loader label="Loading classes…" /> : null
        ) : (
          <EnrollmentBoard
            term={selectedTerm}
            classes={classes}
            programOf={programOf}
            programId={programId}
            onClearProgram={() => setProgramId('')}
          />
        )
      )}

      {view === 'staffing' && (
      <div className="content">
      {/* Same hairline bar as the timetable: switching term keeps the list in
          place and dims it, rather than swapping in a spinner. */}
      {classes !== null && showClassSpinner && (
        <div className="content-progress" role="status" aria-live="polite" aria-label="Loading classes" />
      )}
      {classes === null && showClassSpinner && <Loader label="Loading classes…" />}
      {classes?.length === 0 && (
        <EmptyState
          icon="book"
          title="No classes in this term"
          detail="Nothing is scheduled to teach here yet. Add classes in the Classes module, then come back to staff them."
          className={loadingClasses ? 'stale' : undefined}
        />
      )}

      {classes && classes.length > 0 && shownClasses.length === 0 && (
        <EmptyState
          icon="book"
          title="No classes in this programme"
          detail="This term runs classes, but none of them belong to the programme selected above."
          className={loadingClasses ? 'stale' : undefined}
        />
      )}

      {shownClasses.length > 0 && (
        <Card>
        <table className={loadingClasses ? 'stale' : undefined}>
          <thead>
            <tr>
              <th>Class</th>
              <th>Schedule</th>
              <th>Lead teacher</th>
              <th>Staff</th>
              <th>Enrolled</th>
              <th>Status</th>
              <th className="actions" />
            </tr>
          </thead>
          <tbody>
            {shownClasses.map((k) => {
              const primary = refName(k[C.primary_teacher]);
              const staff = staffCount.get(k.id);
              const status = classTone(str(k[C.status]));
              return (
                <tr key={k.id}>
                  <td>
                    <div className="cell-stack">
                      <Avatar name={str(k[C.name])} />
                      <div className="cell-lines">
                        <div className="cell-title">{str(k[C.name])}</div>
                        <div className="cell-sub">
                          {str(k[C.class_code], "—")}
                          {str(k[C.section_label]) && <> · Section {str(k[C.section_label])}</>}
                          {programOf.get(k.id) && <> · {programOf.get(k.id)?.name}</>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <Schedule klass={k} />
                  </td>
                  <td>
                    {primary ? (
                      <div className="cell-stack">
                        <Avatar name={primary} small />
                        <span>{primary}</span>
                      </div>
                    ) : (
                      <Badge tone="pending" dot>No lead</Badge>
                    )}
                  </td>
                  <td>
                    <Chip>
                      <Icon name="users" size={13} />
                      {staff === undefined
                        ? "…"
                        : staff === 0
                          ? "nobody"
                          : `${staff} allocated`}
                    </Chip>
                  </td>
                  <td>
                    <Occupancy
                      enrolled={int(k[C.enrolled_count])}
                      capacity={int(k[C.capacity])}
                    />
                  </td>
                  <td>
                    <Badge tone={status.tone} dot>{status.label}</Badge>
                  </td>
                  <td className="actions">
                    <Button variant="ghost" onClick={() => setSelectedClass(k)}>
                      Allocate
                      <Icon name="chevron-right" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </Card>
      )}
      </div>
      )}
    </section>
  );
}

/**
 * When a class meets: the weekly pattern, its time, and the room.
 *
 * Staffing a class without this was guesswork -- "who teaches it" cannot be
 * answered without "when is it". The three belong together and are narrow
 * enough to share one column.
 */
function Schedule({ klass }: { klass: RawRecord }) {
  const days = strList(klass[C.meeting_days]);
  const from = str(klass[C.start_time]);
  const to = str(klass[C.end_time]);
  const room = str(klass[C.room]);

  const time = from ? (to ? `${from}–${to}` : from) : "";
  const detail = [time, room].filter(Boolean).join(" · ");

  return (
    <div className="schedule">
      <span className="schedule-days">
        <Icon name="calendar" size={13} />
        {/* A class with no meeting days is the one the generator cannot make
            lessons for, so it is worth saying rather than leaving blank. */}
        {days.length > 0 ? shortDays(days) : <span className="faint">No days set</span>}
      </span>
      <span className="cell-sub schedule-time">{detail || "—"}</span>
    </div>
  );
}

/**
 * Enrolled against capacity.
 *
 * `enrolled` is a Zoho rollup, so it is null until the rollup has been
 * computed for that record -- which is not the same as nobody being enrolled,
 * and is shown as an unknown rather than as a zero.
 */
function Occupancy({ enrolled, capacity }: { enrolled: number | null; capacity: number | null }) {
  if (capacity === null) return <span className="muted">—</span>;

  const pct = enrolled === null || capacity === 0
    ? 0
    : Math.min(100, Math.round((enrolled / capacity) * 100));
  const fill =
    enrolled !== null && enrolled > capacity
      ? "meter-fill over"
      : enrolled !== null && enrolled === capacity
        ? "meter-fill full"
        : "meter-fill";

  return (
    <div className="meter">
      <span className="meter-figures">
        {enrolled ?? "—"}
        <span className="of"> / {capacity}</span>
      </span>
      {/* Decorative: the figures above already state it. */}
      <span className="meter-track" aria-hidden="true">
        <span className={fill} style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

function pickRef(teachers: RawRecord[], id: string | null) {
  if (!id) return null;
  const t = teachers.find((x) => x.id === id);
  return t ? { id, name: str(t[TE.full_name]) } : null;
}

function ClassStaffing({
  klass,
  teachers,
  onPrimaryChanged,
  onStaffChanged,
}: {
  klass: RawRecord;
  teachers: RawRecord[];
  onPrimaryChanged: (teacherId: string | null) => void;
  onStaffChanged: (activeCount: number) => void;
}) {
  const [allocations, setAllocations] = useState<RawRecord[] | null>(null);
  const [teacherId, setTeacherId] = useState("");
  const [role, setRole] = useState<AllocationRole>("Lead Teacher");
  // Defaulted rather than left blank: createAllocation falls back to today
  // anyway, and showing the date it will write beats writing one silently.
  const [effectiveFrom, setEffectiveFrom] = useState(() => orgToday());
  const [effectiveTo, setEffectiveTo] = useState("");
  const [notes, setNotes] = useState("");
  // Whole class, or cover for one dated lesson -- the model's class_session
  // lookup, which nothing has been able to set until now.
  const [scope, setScope] = useState<AllocationScope>("class");
  const [sessionId, setSessionId] = useState("");
  const [sessions, setSessions] = useState<RawRecord[] | null>(null);
  const [busy, setBusy] = useState(false);
  // Which allocation row is mid-write, so the spinner lands on that row rather
  // than on every End button at once.
  const [endingId, setEndingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const showAllocSpinner = useDelayed(allocations === null);
  const showSessionSpinner = useDelayed(scope === "session" && sessions === null);

  /**
   * Re-reads this class's allocations and reports the active count upward.
   *
   * Every mutation goes through here. Updating `allocations` without also
   * telling the parent left the list showing a lead teacher beside "nobody
   * allocated" -- the two derive from the same records, so they have to be
   * refreshed from the same fetch.
   */
  const refresh = useMemo(
    () => async (): Promise<RawRecord[]> => {
      const fresh = await getAllocationsForClass(klass.id);
      setAllocations(fresh);
      onStaffChanged(fresh.filter((a) => a[AL.status] !== "Ended").length);
      return fresh;
    },
    [klass.id, onStaffChanged],
  );

  useEffect(() => {
    refresh().catch((err: unknown) => setError(describeError(err)));
  }, [refresh]);

  // Fetched only when cover is actually chosen. A term's class carries thirty
  // or so sessions, and the ordinary allocation covers all of them -- so this
  // would be a wasted query on every visit to the screen.
  useEffect(() => {
    if (scope !== "session" || sessions !== null) return;
    let cancelled = false;
    getSessionsForClass(klass.id)
      .then((recs) => { if (!cancelled) setSessions(recs); })
      .catch((err: unknown) => { if (!cancelled) setError(describeError(err)); });
    return () => { cancelled = true; };
  }, [scope, sessions, klass.id]);

  const active = allocations?.filter((a) => a[AL.status] !== "Ended") ?? [];
  const alreadyOn = new Set(
    active.map((a) => refId(a[AL.teacher])).filter(Boolean) as string[],
  );
  // Excluded from whole-class staffing because allocating the same teacher to
  // the same class twice is a mistake. Cover is the opposite case: an
  // assistant standing in as lead for one lesson is exactly the point, so the
  // full list stays available there.
  const available = scope === "session" ? teachers : teachers.filter((t) => !alreadyOn.has(t.id));

  const coverSession = sessions?.find((s) => s.id === sessionId) ?? null;
  const canSubmit = Boolean(teacherId) && (scope === "class" || Boolean(sessionId));

  async function add() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await createAllocation({
        teacherId,
        classId: klass.id,
        role,
        classLabel: str(klass[C.class_code], str(klass[C.name], klass.id)),
        effectiveFrom: effectiveFrom || undefined,
        effectiveTo: effectiveTo || undefined,
        notes: notes.trim() || undefined,
        classSessionId: scope === "session" ? sessionId : undefined,
        sessionLabel: scope === "session" && coverSession ? sessionLabel(coverSession) : undefined,
      });
      // The class's headline teacher tracks the lead allocation -- but only a
      // whole-class one. Someone covering a single lesson is not the class's
      // teacher, and promoting them would rewrite what everyone else reads.
      if (role === "Lead Teacher" && scope === "class") {
        await setPrimaryTeacher(klass.id, teacherId);
        onPrimaryChanged(teacherId);
      }
      setTeacherId("");
      setEffectiveTo("");
      setNotes("");
      setSessionId("");
      await refresh();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function end(id: string) {
    setBusy(true);
    setEndingId(id);
    setError(null);
    try {
      await endAllocation(id);
      const fresh = await refresh();

      // The class's headline teacher mirrors the active lead allocation, so it
      // has to follow when one ends. Promote another active lead if there is
      // one, otherwise clear the field -- leaving the old name on the class
      // would show a teacher who is no longer assigned to it.
      const endedTeacher = refId(
        allocations?.find((a) => a.id === id)?.[AL.teacher],
      );
      const currentPrimary = refId(klass[C.primary_teacher]);
      if (endedTeacher && endedTeacher === currentPrimary) {
        const nextLead = fresh.find(
          (a) =>
            a[AL.status] !== 'Ended' &&
            str(a[AL.role]) === 'Lead Teacher' &&
            // Single-lesson cover is not a candidate for the class's headline
            // teacher, for the same reason it never set it.
            !refId(a[AL.class_session]),
        );
        const nextId = nextLead ? refId(nextLead[AL.teacher]) : null;
        await setPrimaryTeacher(klass.id, nextId);
        onPrimaryChanged(nextId);
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
      setEndingId(null);
    }
  }

  const status = classTone(str(klass[C.status]));
  const classCode = str(klass[C.class_code]);

  return (
    <section>
      <Card
        title={str(klass[C.name])}
        subtitle={
          <>
            {str(klass[C.class_code], "—")}
            {str(klass[C.section_label]) && <> · Section {str(klass[C.section_label])}</>}
            {str(klass[C.room]) && <> · {str(klass[C.room])}</>}
          </>
        }
        action={
          <div className="bulk">
            <Occupancy
              enrolled={int(klass[C.enrolled_count])}
              capacity={int(klass[C.capacity])}
            />
            <Badge tone={status.tone} dot>{status.label}</Badge>
          </div>
        }
        body
      >
        <div className="head-meta">
          <Schedule klass={klass} />
        </div>

        {error && <Banner tone="error">{error}</Banner>}

        <div className="form-grid">
          <label className="field">
            <span>Teacher</span>
            <select
              value={teacherId}
              onChange={(e) => setTeacherId(e.target.value)}
              disabled={busy}
            >
              <option value="">Select…</option>
              {available.map((t) => (
                <option key={t.id} value={t.id}>
                  {teacherLabel(t)}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as AllocationRole)}
              disabled={busy}
            >
              {ALLOCATION_ROLE_VALUES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Covers</span>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as AllocationScope)}
              disabled={busy}
            >
              <option value="class">The whole class</option>
              <option value="session">One lesson (cover)</option>
            </select>
          </label>

          {scope === "session" && (
            <label className="field">
              <span>Lesson</span>
              <select
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                disabled={busy || sessions === null}
              >
                <option value="">
                  {sessions === null
                    ? showSessionSpinner ? "Loading lessons…" : "…"
                    : sessions.length === 0
                      ? "No lessons generated yet"
                      : "Select…"}
                </option>
                {(sessions ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {sessionLabel(s)}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="field">
            <span>From</span>
            <input
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              disabled={busy}
            />
          </label>

          <label className="field">
            {/* Optional on purpose: an open-ended allocation is the normal
                case, and "End" on the row below closes one when the time
                comes. This is for cover that is known to be fixed-term. */}
            <span>To (optional)</span>
            <input
              type="date"
              value={effectiveTo}
              min={effectiveFrom || undefined}
              onChange={(e) => setEffectiveTo(e.target.value)}
              disabled={busy}
            />
          </label>

          <label className="field field-wide">
            <span>Notes (optional)</span>
            <textarea
              rows={2}
              value={notes}
              placeholder="Why this allocation exists — covering leave, shared teaching, trial period…"
              onChange={(e) => setNotes(e.target.value)}
              disabled={busy}
            />
          </label>

          <div className="form-actions field-wide">
            <Button variant="primary" onClick={add} disabled={busy || !canSubmit}>
              {busy && !endingId ? (
                <ButtonBusy label="Allocating…" />
              ) : (
                <>
                  <Icon name="plus" />
                  Allocate
                </>
              )}
            </Button>
            {scope === "session" && (
              <span className="muted cover-mark">
                <Icon name="calendar" size={13} />
                Cover does not change the lead teacher on the class.
              </span>
            )}
          </div>
        </div>
      </Card>

      {allocations === null && showAllocSpinner && (
        <Loader label="Loading allocations…" />
      )}
      {allocations?.length === 0 && (
        <EmptyState
          icon="users"
          title="Nobody allocated yet"
          detail="Pick a teacher and a role above to put someone in front of this class."
        />
      )}

      {allocations && allocations.length > 0 && (
        <Card>
        <table>
          <thead>
            <tr>
              <th>Teacher</th>
              <th>Role</th>
              <th>Covers</th>
              <th>Status</th>
              <th>From</th>
              <th>To</th>
              <th className="actions" />
            </tr>
          </thead>
          <tbody>
            {allocations.map((a) => {
              // Row dimming and the End button key off this one value, as they
              // always have; only the badge reads the full status.
              const ended = a[AL.status] === "Ended";
              const teacher = refName(a[AL.teacher]);
              const allocStatus = allocationTone(str(a[AL.status], ""));
              // A session's Name repeats the class code it belongs to
              // ("MATH101-2026T3-A - 2026-10-05"), which is noise inside that
              // class's own table -- the date is the part that identifies it.
              const coverName = refName(a[AL.class_session]).replace(`${classCode} - `, '');
              const note = str(a[AL.notes]);
              return (
                <tr key={a.id} className={ended ? "ended" : undefined}>
                  <td>
                    {teacher ? (
                      <div className="cell-stack">
                        <Avatar name={teacher} small />
                        <div className="cell-lines">
                          <div className="cell-title">{teacher}</div>
                          <div className="cell-sub">{str(a[AL.allocation_no], "—")}</div>
                        </div>
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <div className="cell-lines">
                      <div>{str(a[AL.role], "—")}</div>
                      {/* Why this allocation exists, where there is room for
                          it -- a notes column of its own would be mostly
                          empty and would push the dates off the edge. */}
                      {note && <div className="cell-sub" title={note}>{note}</div>}
                    </div>
                  </td>
                  <td>
                    {coverName ? (
                      <span className="cover-mark">
                        <Icon name="calendar" size={13} />
                        {coverName}
                      </span>
                    ) : (
                      <span className="muted">Whole class</span>
                    )}
                  </td>
                  <td>
                    <Badge tone={allocStatus.tone} dot>{allocStatus.label}</Badge>
                  </td>
                  <td className="muted">
                    <span className="cell-mono">{str(a[AL.effective_from], "—")}</span>
                  </td>
                  <td className="muted">
                    <span className="cell-mono">{str(a[AL.effective_to], "—")}</span>
                  </td>
                  <td className="actions">
                    {!ended && (
                      <Button variant="ghost" onClick={() => end(a.id)} disabled={busy}>
                        {endingId === a.id ? <ButtonBusy label="Ending…" /> : 'End'}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </Card>
      )}
    </section>
  );
}

/** '2026-10-05 09:00' -- enough to pick the right lesson out of thirty. */
function sessionLabel(session: RawRecord): string {
  const stamp = [str(session[S.session_date]), str(session[S.start_time])]
    .filter(Boolean)
    .join(" ");
  return stamp || str(session[S.name], session.id);
}

/**
 * A teacher, with what actually distinguishes one from another.
 *
 * A list of bare names says nothing about who is right for a class;
 * employment type and specialisms are the two the schema carries.
 */
function teacherLabel(teacher: RawRecord): string {
  const name = str(teacher[TE.full_name], teacher.id);
  const detail = [str(teacher[TE.employment_type]), strList(teacher[TE.specialisms]).join(", ")]
    .filter(Boolean)
    .join(" · ");
  return detail ? `${name} — ${detail}` : name;
}
