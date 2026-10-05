import { useEffect, useMemo, useState } from 'react';
import { Loader, ButtonBusy, useDelayed } from './Loader';
import { Avatar, Banner, Button, Card, EmptyState, Icon } from './ui';
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
  getAdmissionsForClass,
  markSessionAttendanceTaken,
  refId,
  refName,
  saveMark,
  type RawRecord,
} from '../zoho/client';

interface Row {
  admissionId: string;
  studentId: string;
  studentName: string;
  /**
   * null means nobody has marked this student yet, and it is a different thing
   * from any of the five values.
   *
   * It used to default to 'Present' with dirty: false, which made an untouched
   * register look like a register in which everybody was present -- and the
   * Save button, counting only dirty rows, agreed there were 0 changes. A
   * teacher could open a lesson, see every student marked Present, close it,
   * and have recorded nothing at all.
   */
  status: AttendanceStatus | null;
  existingId?: string;
  /** Whether this row differs from what is stored. */
  dirty: boolean;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready' };

/**
 * @param onSaved  Called after a successful save with the session's new
 *   Attendance_Taken value, so the timetable that opened this sheet can update
 *   the row in place. The list behind us is state fetched when the day loaded;
 *   without this it keeps saying "Not taken" until something refetches.
 */
export function AttendanceSheet({
  sessionId,
  onSaved,
}: {
  sessionId: string;
  onSaved?: (attendanceTaken: boolean) => void;
}) {
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
  const admissionFields = ZOHO_MODULES.admissions.fields;
  const attendanceFields = ZOHO_MODULES.attendance.fields;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const sess = await getClassSession(sessionId);
        if (!sess) throw new Error(`Session ${sessionId} not found.`);

        const classId = refId(sess[sessionFields.class]);
        if (!classId) throw new Error('This session has no Class linked to it.');

        const [admissions, existing] = await Promise.all([
          getAdmissionsForClass(classId),
          getAttendanceForSession(sessionId),
        ]);

        const next: Row[] = admissions.map((e) => {
          const prior = existing.get(e.id);
          const priorStatus = prior?.[attendanceFields.status];
          return {
            admissionId: e.id,
            studentId: refId(e[admissionFields.student]) ?? '',
            studentName: refName(e[admissionFields.student]) || '(unnamed student)',
            // No fallback. An admission with no attendance record for this
            // session has not been marked, and saying so is the point.
            status: isAttendanceStatus(priorStatus) ? priorStatus : null,
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
  }, [sessionId, sessionFields.class, admissionFields.student, attendanceFields.status]);

  const dirtyCount = useMemo(
    () => rows.filter((r) => r.dirty && r.status !== null).length,
    [rows],
  );
  /* Nobody has marked these. Counted so the footer can say it: a half-taken
     register looks exactly like a finished one once the marked rows are
     saved, and the difference matters more than anything else on the screen. */
  const unmarkedCount = useMemo(() => rows.filter((r) => r.status === null).length, [rows]);

  function setStatus(admissionId: string, status: AttendanceStatus) {
    setRows((prev) =>
      prev.map((r) => (r.admissionId === admissionId ? { ...r, status, dirty: true } : r)),
    );
  }

  function setAll(status: AttendanceStatus) {
    setRows((prev) => prev.map((r) => ({ ...r, status, dirty: true })));
  }

  async function save() {
    if (!session) return;
    const classId = refId(session[sessionFields.class]);
    if (!classId) return;

    // Marked and changed. A row still at null has nothing to write -- and
    // saveMark would have to invent a status for it.
    const pending = rows.filter((r) => r.dirty && r.status !== null);

    // Belt and braces. The UI disables these controls, but the guard is
    // re-checked here so a stale row can never slip an observation onto a
    // lesson that has not happened.
    const futureAtSave = isFutureDate(String(session[sessionFields.session_date] ?? ''));
    if (futureAtSave) {
      const bad = pending.find(
        (r) => r.status !== null && !FUTURE_ALLOWED_STATUSES.includes(r.status),
      );
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
            admissionId: row.admissionId,
            studentId: row.studentId,
            classId,
            // Narrowed by the pending filter above; the field is non-null.
            status: row.status as AttendanceStatus,
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
      onSaved?.(!futureAtSave);
    } catch (err) {
      setPhase({ kind: 'error', message: describeError(err) });
    } finally {
      setProgress(null);
    }
  }

  if (phase.kind === 'loading') return showRosterSpinner ? <Loader label="Loading roster…" /> : null;
  if (phase.kind === 'error') return <Banner tone="error">{phase.message}</Banner>;

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
      <Card
        title={
          <span className="cell-stack">
            <Avatar name={sessionName} />
            {sessionName}
          </span>
        }
        subtitle={sessionDate}
        action={
          /* Bulk actions apply to every row, so they are meaningless with no
             rows -- and "All Excused" beside "Nobody placed" invites a
             click that cannot do anything. */
          rows.length > 0 && !cancelled ? (
            <div className="bulk">
              <span className="bulk-label">Mark all</span>
              {ATTENDANCE_STATUS_VALUES.filter(allowed).map((s) => (
                <Button key={s} small onClick={() => setAll(s)} disabled={saving}>
                  {s}
                </Button>
              ))}
            </div>
          ) : undefined
        }
      >
        {cancelled && (
          <EmptyState
            icon="slash"
            title="This lesson was cancelled"
            detail="A cancelled lesson has no register. Set its status back to Scheduled in the Class Sessions module if it is going ahead after all."
          />
        )}

        {!cancelled && future && (
          <div className="card-body">
            <Banner tone="warn">
              <strong>This lesson has not happened yet ({sessionDate}).</strong>{' '}
              Present, Absent, Late and Left Early record what was observed, so they
              are unavailable. Excused can be set in advance for a known absence.
            </Banner>
          </div>
        )}

        {cancelled ? null : rows.length === 0 ? (
          <EmptyState
            icon="users"
            title="No students enrolled"
            detail="Nobody is placed in this class, so there is no register to take. Place students into it from the Class Allocation tab."
          />
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
                <tr
                  key={row.admissionId}
                  className={[row.dirty ? 'dirty' : '', row.status === null ? 'unmarked' : '']
                    .filter(Boolean)
                    .join(' ') || undefined}
                >
                  <td>
                    <div className="cell-stack">
                      <Avatar name={row.studentName} small />
                      <span className="cell-title">{row.studentName}</span>
                    </div>
                  </td>
                  <td>
                    {/* A segmented control, but still five real radios sharing
                        one name: the inputs are clipped rather than hidden, so
                        the group keeps its semantics and its arrow-key
                        navigation. */}
                    <div className="seg-choices">
                      {ATTENDANCE_STATUS_VALUES.map((s) => (
                        <label key={s} className={allowed(s) ? undefined : 'unavailable'}>
                          <input
                            type="radio"
                            name={`att-${row.admissionId}`}
                            checked={row.status === s}
                            onChange={() => setStatus(row.admissionId, s)}
                            disabled={saving || cancelled || !allowed(s)}
                          />
                          <span>{s}</span>
                        </label>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {!cancelled && rows.length > 0 && (
      <footer className="sheet-foot">
        <Button variant="primary" onClick={save} disabled={saving || dirtyCount === 0}>
          {progress
            ? <ButtonBusy label={`Saving ${progress.done} of ${progress.total}…`} />
            : `Save ${dirtyCount} change${dirtyCount === 1 ? '' : 's'}`}
        </Button>
        {unmarkedCount > 0 && !saving && (
          <span className="unmarked-note">
            <Icon name="alert" size={15} />
            {unmarkedCount} not marked
          </span>
        )}
        <span className="spacer" />
        {savedAt && !saving && dirtyCount === 0 && (
          <span className="saved-note">
            <Icon name="check-circle" size={15} />
            Saved {savedAt.toLocaleTimeString()}
          </span>
        )}
      </footer>
      )}
    </section>
  );
}

function isAttendanceStatus(v: unknown): v is AttendanceStatus {
  return typeof v === 'string' && (ATTENDANCE_STATUS_VALUES as readonly string[]).includes(v);
}
