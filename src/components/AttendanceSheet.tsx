import { useEffect, useMemo, useState } from 'react';
import { Loader, ButtonBusy, useDelayed } from './Loader';
import { ATTENDANCE_STATUS_VALUES, type AttendanceStatus } from '../generated/db-types';
import {
  describeError,
  FUTURE_ALLOWED_STATUSES,
  getAttendanceForSession,
  getClassSession,
  getEnrollmentsForClass,
  getStudentNames,
  isFutureDate,
  markSessionAttendanceTaken,
  saveMark,
  str,
  type ClassSession,
} from '../data/client';

interface Row {
  enrollmentId: number;
  studentId: number;
  studentName: string;
  status: AttendanceStatus;
  existingId?: number;
  /** Whether this row differs from what is stored. */
  dirty: boolean;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready' };

export function AttendanceSheet({ sessionId }: { sessionId: number }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [session, setSession] = useState<ClassSession | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  // Writes are sequential, so the count is genuinely known -- show it rather
  // than an indeterminate spinner.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const saving = progress !== null;
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const showRosterSpinner = useDelayed(phase.kind === 'loading');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const sess = await getClassSession(sessionId);
        if (!sess) throw new Error(`Session ${sessionId} not found.`);

        const [enrollments, existing] = await Promise.all([
          getEnrollmentsForClass(sess.class_id),
          getAttendanceForSession(sessionId),
        ]);

        // A row carries student_id, not a student name -- so names are a second
        // lookup rather than arriving free on the reference as they did in CRM.
        const names = await getStudentNames(enrollments.map((e) => e.student_id));

        const next: Row[] = enrollments.map((e) => {
          const prior = existing.get(e.id);
          return {
            enrollmentId: e.id,
            studentId: e.student_id,
            studentName: names.get(e.student_id) ?? '(unnamed student)',
            status: prior?.status ?? 'Present',
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
        setPhase({ kind: 'error', message: describeError(err) });
      }
    })();

    return () => { cancelled = true; };
  }, [sessionId]);

  const dirtyCount = useMemo(() => rows.filter((r) => r.dirty).length, [rows]);

  function setStatus(enrollmentId: number, status: AttendanceStatus) {
    setRows((prev) =>
      prev.map((r) => (r.enrollmentId === enrollmentId ? { ...r, status, dirty: true } : r)),
    );
  }

  function setAll(status: AttendanceStatus) {
    setRows((prev) => prev.map((r) => ({ ...r, status, dirty: true })));
  }

  async function save() {
    if (!session) return;
    const pending = rows.filter((r) => r.dirty);

    // Belt and braces. The UI disables these controls, but the guard is
    // re-checked here so a stale row can never slip an observation onto a
    // lesson that has not happened.
    const futureAtSave = isFutureDate(session.session_date);
    if (futureAtSave) {
      const bad = pending.find((r) => !FUTURE_ALLOWED_STATUSES.includes(r.status));
      if (bad) {
        setPhase({
          kind: 'error',
          message:
            `Cannot record "${bad.status}" for ${bad.studentName}: ` +
            `that lesson has not happened yet.`,
        });
        return;
      }
    }

    // +1 for the session's own attendance_taken flag, so the count reaches its
    // total instead of stalling one short at the end.
    setProgress({ done: 0, total: pending.length + 1 });
    try {
      for (const row of pending) {
        await saveMark(
          sessionId,
          {
            enrollmentId: row.enrollmentId,
            studentId: row.studentId,
            classId: session.class_id,
            status: row.status,
            studentName: row.studentName,
            ...(row.existingId ? { existingId: row.existingId } : {}),
          },
          null,
          session.name,
        );
        setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
      }
      // A future lesson stays Scheduled: saving an advance excusal must not
      // claim the lesson was held.
      await markSessionAttendanceTaken(sessionId, null, !futureAtSave);
      setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
      setRows((prev) => prev.map((r) => ({ ...r, dirty: false })));
      setSavedAt(new Date());
    } catch (err) {
      setPhase({ kind: 'error', message: describeError(err) });
    } finally {
      setProgress(null);
    }
  }

  if (phase.kind === 'loading') {
    return showRosterSpinner ? <Loader label="Loading roster…" /> : null;
  }
  if (phase.kind === 'error') return <p className="error">{phase.message}</p>;

  const sessionName = str(session?.name, 'Session');
  const sessionDate = str(session?.session_date);

  // A cancelled lesson did not happen, so it has no register at all.
  const cancelled = session?.status === 'Cancelled';
  // A future lesson has not happened yet, so only a decision (Excused) can be
  // recorded -- never an observation.
  const future = isFutureDate(sessionDate);
  const allowed = (s: AttendanceStatus) => !future || FUTURE_ALLOWED_STATUSES.includes(s);

  return (
    <section>
      <header className="sheet-head">
        <div>
          <h2>{sessionName}</h2>
          <p className="muted">{sessionDate}</p>
        </div>
        {/* Bulk actions apply to every row, so they are meaningless with no
            rows -- and "All Excused" beside "No students enrolled" invites a
            click that cannot do anything. */}
        {rows.length > 0 && !cancelled && (
          <div className="bulk">
            {ATTENDANCE_STATUS_VALUES.filter(allowed).map((s) => (
              <button key={s} type="button" onClick={() => setAll(s)} disabled={saving}>
                All {s}
              </button>
            ))}
          </div>
        )}
      </header>

      {cancelled && (
        <div className="notice">
          <h2>This lesson was cancelled</h2>
          <p className="muted">
            A cancelled lesson has no register. Set its status back to Scheduled
            if it is going ahead after all.
          </p>
        </div>
      )}

      {!cancelled && future && (
        <p className="devbar">
          <strong>This lesson has not happened yet ({sessionDate}).</strong>{' '}
          Present, Absent, Late and Left Early record what was observed, so they
          are unavailable. Excused can be set in advance for a known absence.
        </p>
      )}

      {cancelled ? null : rows.length === 0 ? (
        <div className="empty">
          <h2>No students enrolled</h2>
          <p className="muted">
            Nobody has an active enrollment in this class, so there is no
            register to take. Add enrollments first.
          </p>
        </div>
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
                      <label key={s} className={allowed(s) ? undefined : 'unavailable'}>
                        <input
                          type="radio"
                          name={`att-${row.enrollmentId}`}
                          checked={row.status === s}
                          onChange={() => setStatus(row.enrollmentId, s)}
                          disabled={saving || !allowed(s)}
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

      {!cancelled && rows.length > 0 && (
        <footer className="sheet-foot">
          <button type="button" onClick={save} disabled={saving || dirtyCount === 0}>
            {progress
              ? <ButtonBusy label={`Saving ${progress.done} of ${progress.total}…`} />
              : `Save ${dirtyCount} change${dirtyCount === 1 ? '' : 's'}`}
          </button>
          {savedAt && !saving && dirtyCount === 0 && (
            <span className="muted">Saved {savedAt.toLocaleTimeString()}</span>
          )}
        </footer>
      )}
    </section>
  );
}
