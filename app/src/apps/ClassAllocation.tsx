import { useEffect, useMemo, useState } from 'react';
import { ZOHO_MODULES, ALLOCATION_ROLE_VALUES, type AllocationRole } from '../generated/types';
import {
  createAllocation,
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
} from '../zoho/client';

const C = ZOHO_MODULES.classes.fields;
const T = ZOHO_MODULES.terms.fields;
const TE = ZOHO_MODULES.teachers.fields;
const AL = ZOHO_MODULES.allocations.fields;

/** Web-tab entry point for staffing: term → class → who teaches it. */
export function ClassAllocation() {
  const [terms, setTerms] = useState<RawRecord[] | null>(null);
  const [termId, setTermId] = useState<string>('');
  const [classes, setClasses] = useState<RawRecord[] | null>(null);
  const [teachers, setTeachers] = useState<RawRecord[]>([]);
  const [selectedClass, setSelectedClass] = useState<RawRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!termId) return;
    let cancelled = false;
    setClasses(null);
    setSelectedClass(null);
    getClassesForTerm(termId)
      .then((cs) => { if (!cancelled) setClasses(cs); })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => { cancelled = true; };
  }, [termId]);

  if (error) return <p className="error">{error}</p>;
  if (terms === null) return <p className="muted">Loading terms…</p>;
  if (terms.length === 0) return <p className="muted">No open or running terms.</p>;

  if (selectedClass) {
    return (
      <>
        <button type="button" className="back" onClick={() => setSelectedClass(null)}>
          ← Back to classes
        </button>
        <ClassStaffing
          klass={selectedClass}
          teachers={teachers}
          onPrimaryChanged={(teacherId) =>
            setSelectedClass({ ...selectedClass, [C.primary_teacher]: pickRef(teachers, teacherId) })
          }
        />
      </>
    );
  }

  return (
    <section>
      <div className="toolbar">
        <label>
          Term{' '}
          <select value={termId} onChange={(e) => setTermId(e.target.value)}>
            {terms.map((t) => (
              <option key={t.id} value={t.id}>{str(t[T.name], t.id)}</option>
            ))}
          </select>
        </label>
      </div>

      {classes === null && <p className="muted">Loading classes…</p>}
      {classes?.length === 0 && <p className="muted">No classes in this term.</p>}

      {classes && classes.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Class</th>
              <th>Code</th>
              <th>Primary teacher</th>
              <th>Capacity</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {classes.map((k) => {
              const primary = refName(k[C.primary_teacher]);
              return (
                <tr key={k.id}>
                  <td>{str(k[C.name])}</td>
                  <td>{str(k[C.class_code], '—')}</td>
                  <td>{primary || <span className="pill todo">Unassigned</span>}</td>
                  <td>{String(k[C.capacity] ?? '—')}</td>
                  <td>
                    <button type="button" onClick={() => setSelectedClass(k)}>Allocate</button>
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

function pickRef(teachers: RawRecord[], id: string) {
  const t = teachers.find((x) => x.id === id);
  return t ? { id, name: str(t[TE.full_name]) } : null;
}

function ClassStaffing({
  klass,
  teachers,
  onPrimaryChanged,
}: {
  klass: RawRecord;
  teachers: RawRecord[];
  onPrimaryChanged: (teacherId: string) => void;
}) {
  const [allocations, setAllocations] = useState<RawRecord[] | null>(null);
  const [teacherId, setTeacherId] = useState('');
  const [role, setRole] = useState<AllocationRole>('Lead Teacher');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useMemo(
    () => () =>
      getAllocationsForClass(klass.id)
        .then(setAllocations)
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err))),
    [klass.id],
  );

  useEffect(() => { void reload(); }, [reload]);

  const active = allocations?.filter((a) => a[AL.status] !== 'Ended') ?? [];
  const alreadyOn = new Set(active.map((a) => refId(a[AL.teacher])).filter(Boolean) as string[]);
  const available = teachers.filter((t) => !alreadyOn.has(t.id));

  async function add() {
    if (!teacherId) return;
    setBusy(true);
    setError(null);
    try {
      await createAllocation({ teacherId, classId: klass.id, role });
      // The class's headline teacher tracks the lead allocation.
      if (role === 'Lead Teacher') {
        await setPrimaryTeacher(klass.id, teacherId);
        onPrimaryChanged(teacherId);
      }
      setTeacherId('');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function end(id: string) {
    setBusy(true);
    setError(null);
    try {
      await endAllocation(id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <header className="sheet-head">
        <div>
          <h2>{str(klass[C.name])}</h2>
          <p className="muted">
            {str(klass[C.class_code], '—')} · capacity {String(klass[C.capacity] ?? '—')}
          </p>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="toolbar">
        <label>
          Teacher{' '}
          <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} disabled={busy}>
            <option value="">Select…</option>
            {available.map((t) => (
              <option key={t.id} value={t.id}>{str(t[TE.full_name], t.id)}</option>
            ))}
          </select>
        </label>
        <label>
          Role{' '}
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as AllocationRole)}
            disabled={busy}
          >
            {ALLOCATION_ROLE_VALUES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={add} disabled={busy || !teacherId}>
          {busy ? 'Saving…' : 'Allocate'}
        </button>
      </div>

      {allocations === null && <p className="muted">Loading allocations…</p>}
      {allocations?.length === 0 && <p className="muted">Nobody allocated to this class yet.</p>}

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
              const ended = a[AL.status] === 'Ended';
              return (
                <tr key={a.id} className={ended ? 'ended' : undefined}>
                  <td>{refName(a[AL.teacher]) || '—'}</td>
                  <td>{str(a[AL.role], '—')}</td>
                  <td>
                    <span className={`pill ${ended ? 'todo' : 'done'}`}>
                      {str(a[AL.status], '—')}
                    </span>
                  </td>
                  <td>{str(a[AL.effective_from], '—')}</td>
                  <td>
                    {!ended && (
                      <button type="button" onClick={() => end(a.id)} disabled={busy}>
                        End
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
