import { useEffect, useMemo, useState } from 'react';
import {
  ZOHO_MODULES,
  ATTENDANCE_STATUS_VALUES,
  type AttendanceStatus,
} from '../generated/types';
import {
  getAttendanceForSession,
  getClassSession,
  getEnrollmentsForClass,
  markSessionAttendanceTaken,
  refId,
  refName,
  saveMark,
  type RawRecord,
} from '../zoho/client';

interface Row {
  enrollmentId: string;
  studentId: string;
  studentName: string;
  status: AttendanceStatus;
  existingId?: string;
  /** Whether this row differs from what is stored. */
  dirty: boolean;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready' };

export function AttendanceSheet({ sessionId }: { sessionId: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [session, setSession] = useState<RawRecord | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const sessionFields = ZOHO_MODULES.class_sessions.fields;
  const enrollmentFields = ZOHO_MODULES.enrollments.fields;
  const attendanceFields = ZOHO_MODULES.attendance.fields;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const sess = await getClassSession(sessionId);
        if (!sess) throw new Error(`Session ${sessionId} not found.`);

        const classId = refId(sess[sessionFields.class]);
        if (!classId) throw new Error('This session has no Class linked to it.');

        const [enrollments, existing] = await Promise.all([
          getEnrollmentsForClass(classId),
          getAttendanceForSession(sessionId),
        ]);

        const next: Row[] = enrollments.map((e) => {
          const prior = existing.get(e.id);
          const priorStatus = prior?.[attendanceFields.status];
          return {
            enrollmentId: e.id,
            studentId: refId(e[enrollmentFields.student]) ?? '',
            studentName: refName(e[enrollmentFields.student]) || '(unnamed student)',
            status: isAttendanceStatus(priorStatus) ? priorStatus : 'Present',
            existingId: prior?.id,
            dirty: false,
          };
        });
        next.sort((a, b) => a.studentName.localeCompare(b.studentName));

        if (cancelled) return;
        setSession(sess);
        setRows(next);
        setPhase({ kind: 'ready' });
      } catch (err) {
        if (cancelled) return;
        setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    })();

    return () => { cancelled = true; };
  }, [sessionId, sessionFields.class, enrollmentFields.student, attendanceFields.status]);

  const dirtyCount = useMemo(() => rows.filter((r) => r.dirty).length, [rows]);

  function setStatus(enrollmentId: string, status: AttendanceStatus) {
    setRows((prev) =>
      prev.map((r) => (r.enrollmentId === enrollmentId ? { ...r, status, dirty: true } : r)),
    );
  }

  function setAll(status: AttendanceStatus) {
    setRows((prev) => prev.map((r) => ({ ...r, status, dirty: true })));
  }

  async function save() {
    if (!session) return;
    const classId = refId(session[sessionFields.class]);
    if (!classId) return;

    setSaving(true);
    try {
      // Sequential rather than Promise.all: Zoho rate-limits bursts, and a
      // partial failure is far easier to reason about in order.
      for (const row of rows.filter((r) => r.dirty)) {
        await saveMark(
          sessionId,
          {
            enrollmentId: row.enrollmentId,
            studentId: row.studentId,
            classId,
            status: row.status,
            ...(row.existingId ? { existingId: row.existingId } : {}),
          },
          null,
        );
      }
      await markSessionAttendanceTaken(sessionId, null);
      setRows((prev) => prev.map((r) => ({ ...r, dirty: false })));
      setSavedAt(new Date());
    } catch (err) {
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }

  if (phase.kind === 'loading') return <p className="muted">Loading roster…</p>;
  if (phase.kind === 'error') return <p className="error">{phase.message}</p>;

  const sessionName = String(session?.[sessionFields.name] ?? 'Session');
  const sessionDate = String(session?.[sessionFields.session_date] ?? '');

  return (
    <section>
      <header className="sheet-head">
        <div>
          <h2>{sessionName}</h2>
          <p className="muted">{sessionDate}</p>
        </div>
        <div className="bulk">
          {ATTENDANCE_STATUS_VALUES.map((s) => (
            <button key={s} type="button" onClick={() => setAll(s)} disabled={saving}>
              All {s}
            </button>
          ))}
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="muted">No active enrollments in this class.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Attendance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.enrollmentId} className={row.dirty ? 'dirty' : undefined}>
                <td>{row.studentName}</td>
                <td>
                  <div className="choices">
                    {ATTENDANCE_STATUS_VALUES.map((s) => (
                      <label key={s}>
                        <input
                          type="radio"
                          name={`att-${row.enrollmentId}`}
                          checked={row.status === s}
                          onChange={() => setStatus(row.enrollmentId, s)}
                          disabled={saving}
                        />
                        {s}
                      </label>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <footer className="sheet-foot">
        <button type="button" onClick={save} disabled={saving || dirtyCount === 0}>
          {saving ? 'Saving…' : `Save ${dirtyCount} change${dirtyCount === 1 ? '' : 's'}`}
        </button>
        {savedAt && !saving && dirtyCount === 0 && (
          <span className="muted">Saved {savedAt.toLocaleTimeString()}</span>
        )}
      </footer>
    </section>
  );
}

function isAttendanceStatus(v: unknown): v is AttendanceStatus {
  return typeof v === 'string' && (ATTENDANCE_STATUS_VALUES as readonly string[]).includes(v);
}
