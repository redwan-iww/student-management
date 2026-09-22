import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader, ButtonBusy, useDelayed } from '../components/Loader';
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
  getTeachers,
  refId,
  refName,
  setPrimaryTeacher,
  str,
  type RawRecord,
} from "../zoho/client";

const C = ZOHO_MODULES.classes.fields;
const T = ZOHO_MODULES.terms.fields;
const TE = ZOHO_MODULES.teachers.fields;
const AL = ZOHO_MODULES.allocations.fields;

/** Web-tab entry point for staffing: term → class → who teaches it. */
export function ClassAllocation() {
  const [terms, setTerms] = useState<RawRecord[] | null>(null);
  const [termId, setTermId] = useState<string>("");
  const [classes, setClasses] = useState<RawRecord[] | null>(null);
  const [teachers, setTeachers] = useState<RawRecord[]>([]);
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
    Promise.all([getActiveTerms(), getTeachers()])
      .then(([ts, teach]) => {
        if (cancelled) return;
        setTerms(ts);
        setTeachers(teach);
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

  if (error) return <p className="error">{error}</p>;
  if (terms === null) return showTermsSpinner ? <Loader label="Loading terms…" /> : null;
  if (terms.length === 0)
    return <p className="muted">No open or running terms.</p>;

  if (selectedClass) {
    return (
      <>
        <button
          type="button"
          className="back"
          onClick={() => setSelectedClass(null)}
        >
          ← Back to classes
        </button>
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
  // return <div>hi</div>;

  return (
    <section>
      <div className="toolbar">
        <label>
          Term{" "}
          <select value={termId} onChange={(e) => setTermId(e.target.value)}>
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {str(t[T.name], t.id)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="content">
      {/* Same hairline bar as the timetable: switching term keeps the list in
          place and dims it, rather than swapping in a spinner. */}
      {classes !== null && showClassSpinner && (
        <div className="content-progress" role="status" aria-live="polite" aria-label="Loading classes" />
      )}
      {classes === null && showClassSpinner && <Loader label="Loading classes…" />}
      {classes?.length === 0 && (
        <p className="muted">No classes in this term.</p>
      )}

      {classes && classes.length > 0 && (
        <table className={loadingClasses ? 'stale' : undefined}>
          <thead>
            <tr>
              <th>Class</th>
              <th>Code</th>
              <th>Lead teacher</th>
              <th>Staff</th>
              <th>Capacity</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {classes.map((k) => {
              const primary = refName(k[C.primary_teacher]);
              const staff = staffCount.get(k.id);
              return (
                <tr key={k.id}>
                  <td>{str(k[C.name])}</td>
                  <td>{str(k[C.class_code], "—")}</td>
                  <td>
                    {primary || <span className="pill todo">No lead</span>}
                  </td>
                  <td className="muted">
                    {staff === undefined
                      ? "…"
                      : staff === 0
                        ? "nobody"
                        : `${staff} allocated`}
                  </td>
                  <td>{String(k[C.capacity] ?? "—")}</td>
                  <td>
                    <button type="button" onClick={() => setSelectedClass(k)}>
                      Allocate
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      </div>
    </section>
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
  const [busy, setBusy] = useState(false);
  // Which allocation row is mid-write, so the spinner lands on that row rather
  // than on every End button at once.
  const [endingId, setEndingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const showAllocSpinner = useDelayed(allocations === null);

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

  const active = allocations?.filter((a) => a[AL.status] !== "Ended") ?? [];
  const alreadyOn = new Set(
    active.map((a) => refId(a[AL.teacher])).filter(Boolean) as string[],
  );
  const available = teachers.filter((t) => !alreadyOn.has(t.id));

  async function add() {
    if (!teacherId) return;
    setBusy(true);
    setError(null);
    try {
      await createAllocation({
        teacherId,
        classId: klass.id,
        role,
        classLabel: str(klass[C.class_code], str(klass[C.name], klass.id)),
      });
      // The class's headline teacher tracks the lead allocation.
      if (role === "Lead Teacher") {
        await setPrimaryTeacher(klass.id, teacherId);
        onPrimaryChanged(teacherId);
      }
      setTeacherId("");
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
          (a) => a[AL.status] !== 'Ended' && str(a[AL.role]) === 'Lead Teacher',
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

  return (
    <section>
      <header className="sheet-head">
        <div>
          <h2>{str(klass[C.name])}</h2>
          <p className="muted">
            {str(klass[C.class_code], "—")} · capacity{" "}
            {String(klass[C.capacity] ?? "—")}
          </p>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="toolbar">
        <label>
          Teacher{" "}
          <select
            value={teacherId}
            onChange={(e) => setTeacherId(e.target.value)}
            disabled={busy}
          >
            <option value="">Select…</option>
            {available.map((t) => (
              <option key={t.id} value={t.id}>
                {str(t[TE.full_name], t.id)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Role{" "}
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
        <button type="button" onClick={add} disabled={busy || !teacherId}>
          {busy && !endingId ? <ButtonBusy label="Allocating…" /> : "Allocate"}
        </button>
      </div>

      {allocations === null && showAllocSpinner && (
        <Loader label="Loading allocations…" />
      )}
      {allocations?.length === 0 && (
        <p className="muted">Nobody allocated to this class yet.</p>
      )}

      {allocations && allocations.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Teacher</th>
              <th>Role</th>
              <th>Status</th>
              <th>From</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {allocations.map((a) => {
              const ended = a[AL.status] === "Ended";
              return (
                <tr key={a.id} className={ended ? "ended" : undefined}>
                  <td>{refName(a[AL.teacher]) || "—"}</td>
                  <td>{str(a[AL.role], "—")}</td>
                  <td>
                    <span className={`pill ${ended ? "todo" : "done"}`}>
                      {str(a[AL.status], "—")}
                    </span>
                  </td>
                  <td>{str(a[AL.effective_from], "—")}</td>
                  <td>
                    {!ended && (
                      <button
                        type="button"
                        onClick={() => end(a.id)}
                        disabled={busy}
                      >
                        {endingId === a.id ? <ButtonBusy label="Ending…" /> : 'End'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
