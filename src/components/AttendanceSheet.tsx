import { useEffect, useMemo, useState } from 'react';
import { Loader, ButtonBusy, useDelayed } from './Loader';
import {
  ZOHO_MODULES,
  ATTENDANCE_STATUS_VALUES,
  type AttendanceStatus,
} from '../generated/types';
import {
  describeError,
  FUTURE_ALLOWED_STATUSES,
  getAttendanceForSession,
  isFutureDate,
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
  // Writes are sequential, so the count is genuinely known -- show it rather
  // than an indeterminate spinner.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const saving = progress !== null;
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const showRosterSpinner = useDelayed(phase.kind === 'loading');

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
        setPhase({ kind: 'error', message: describeError(err) });
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

    const pending = rows.filter((r) => r.dirty);

    // Belt and braces. The UI disables these controls, but the guard is
    // re-checked here so a stale row can never slip an observation onto a
    // lesson that has not happened.
    const futureAtSave = isFutureDate(String(session[sessionFields.session_date] ?? ''));
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
      // Sequential rather than Promise.all: Zoho rate-limits bursts, and a
      // partial failure is far easier to reason about in order.
      for (const row of pending) {
        await saveMark(
          sessionId,
          {
            enrollmentId: row.enrollmentId,
            studentId: row.studentId,
            classId,
            status: row.status,
            studentName: row.studentName,
            ...(row.existingId ? { existingId: row.existingId } : {}),
          },
          null,
          String(session[sessionFields.name] ?? sessionId),
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

  if (phase.kind === 'loading') return showRosterSpinner ? <Loader label="Loading roster…" /> : null;
  if (phase.kind === 'error') return <p className="error">{phase.message}</p>;

  const sessionName = String(session?.[sessionFields.name] ?? 'Session');
  const sessionDate = String(session?.[sessionFields.session_date] ?? '');
  const sessionStatus = String(session?.[sessionFields.status] ?? '');

  // A cancelled lesson did not happen, so it has no register at all.
  const cancelled = sessionStatus === 'Cancelled';
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
            rows -- and "All Excused" beside "No active enrollments" invites a
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
            in the Class Sessions module if it is going ahead after all.
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
            register to take. Add enrollments in the Enrollments module first.
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
                          disabled={saving || cancelled || !allowed(s)}
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

function isAttendanceStatus(v: unknown): v is AttendanceStatus {
  return typeof v === 'string' && (ATTENDANCE_STATUS_VALUES as readonly string[]).includes(v);
}
