import { useEffect, useState } from 'react';
import { ZOHO_MODULES } from '../generated/types';
import { AttendanceSheet } from '../components/AttendanceSheet';
import { getSessionsForDate, refName, str, type RawRecord } from '../zoho/client';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Web-tab entry point for attendance.
 *
 * A detail-view widget would have been handed a session id. A web tab is not,
 * so the tab opens on today's timetable and the user picks the session.
 */
export function AttendanceManager() {
  const [date, setDate] = useState(today);
  const [sessions, setSessions] = useState<RawRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const F = ZOHO_MODULES.class_sessions.fields;

  useEffect(() => {
    let cancelled = false;
    setSessions(null);
    setSelected(null);
    setError(null);

    getSessionsForDate(date)
      .then((recs) => { if (!cancelled) setSessions(recs); })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });

    return () => { cancelled = true; };
  }, [date]);

  if (selected) {
    return (
      <>
        <button type="button" className="back" onClick={() => setSelected(null)}>
          ← Back to {date}
        </button>
        <AttendanceSheet sessionId={selected} />
      </>
    );
  }

  return (
    <section>
      <div className="toolbar">
        <label>
          Date{' '}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <button type="button" onClick={() => setDate(today())}>Today</button>
      </div>

      {error && <p className="error">{error}</p>}
      {!error && sessions === null && <p className="muted">Loading timetable…</p>}
      {sessions?.length === 0 && <p className="muted">No sessions scheduled on {date}.</p>}

      {sessions && sessions.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Session</th>
              <th>Class</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => {
              const taken = s[F.attendance_taken] === true;
              return (
                <tr key={s.id}>
                  <td>{str(s[F.start_time], '—')}</td>
                  <td>{str(s[F.name])}</td>
                  <td>{refName(s[F.class]) || '—'}</td>
                  <td>
                    {taken
                      ? <span className="pill done">Attendance taken</span>
                      : <span className="pill todo">Not taken</span>}
                  </td>
                  <td>
                    <button type="button" onClick={() => setSelected(s.id)}>
                      {taken ? 'Review' : 'Take attendance'}
                    </button>
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
