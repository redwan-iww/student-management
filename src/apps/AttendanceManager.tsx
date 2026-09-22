import { useEffect, useState } from 'react';

import { AttendanceSheet } from '../components/AttendanceSheet';
import { Loader, useDelayed } from '../components/Loader';
import { GenerateSessions } from '../components/GenerateSessions';
import {
  describeError,
  getClassesByIds,
  getSessionsForDate,
  getTermNames,
  isFutureDate,
  orgToday,
  str,
  type ClassSession,
} from '../data/client';

// The school's today, not the browser's -- see ORG_TIME_ZONE in client.ts.
const today = orgToday;

/**
 * Weekday for a yyyy-MM-dd string, read in UTC.
 *
 * An empty day is nearly always just a day nobody teaches, so saying which
 * weekday it is answers the question before it is asked.
 */
const weekdayOf = (isoDate: string) =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long',
    timeZone: 'UTC',
  });

/** '20 September 2026' -- the human form, for a headline rather than a field. */
const longDateOf = (isoDate: string) =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** Step a yyyy-MM-dd date by whole days, staying in UTC. */
const shiftDate = (isoDate: string, days: number) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Web-tab entry point for attendance.
 *
 * A detail-view widget would have been handed a session id. A web tab is not,
 * so the tab opens on today's timetable and the user picks the session.
 */
export function AttendanceManager() {
  const [date, setDate] = useState(today);
  const [sessions, setSessions] = useState<ClassSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  // Bumped to force a refetch of the same date -- setDate(d => d) is a no-op,
  // because React bails out when the next state is identical.
  const [reloadKey, setReloadKey] = useState(0);
  // Distinct from sessions === null. Changing date keeps the previous day on
  // screen and dims it, so the panel does not collapse and rebuild on every
  // step -- only the very first load has nothing to show.
  const [loading, setLoading] = useState(true);
  // The lesson generator is opt-in -- see the disclosure below.
  const [setupOpen, setSetupOpen] = useState(false);
  // Term name per class id. Resolved separately because a session carries no
  // Term of its own -- it reaches one only through its Class.
  const [termByClass, setTermByClass] = useState<Map<number, string>>(new Map());
  const [classNames, setClassNames] = useState<Map<number, string>>(new Map());

  // Only surface a spinner once the wait is long enough to notice; a fast
  // fetch would otherwise flash one and read as a glitch.
  const showSpinner = useDelayed(loading);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSelected(null);
    setError(null);

    getSessionsForDate(date)
      .then(async (recs) => {
        if (cancelled) return;
        // Show the timetable immediately; the term column fills in a moment
        // later rather than holding the whole table back for one extra hop.
        setSessions(recs);
        setLoading(false);

        // A session carries class_id, and the term hangs off the class -- so
        // the term name is two hops: classes by id, then terms by id.
        const classIds = recs.map((r) => r.class_id).filter(Boolean);
        if (classIds.length === 0) return;
        const classes = await getClassesByIds(classIds);
        if (cancelled) return;

        const termNames = await getTermNames([...classes.values()].map((c) => c.term_id));
        if (cancelled) return;

        const next = new Map<number, string>();
        for (const [id, klass] of classes) {
          next.set(id, termNames.get(klass.term_id) ?? '');
        }
        setTermByClass(next);
        setClassNames(new Map([...classes].map(([id, k]) => [id, str(k.class_code, str(k.name))])));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(describeError(err));
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [date, reloadKey]);

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

        {/* Stepping is the common move -- most days are empty or hold one
            lesson -- so it belongs next to the field rather than only in the
            empty state. Labelled with the weekday they land on, since an
            unadorned arrow says nothing about where it goes. */}
        <div className="daynav">
          <button
            type="button"
            onClick={() => setDate(shiftDate(date, -1))}
            title={`Previous day — ${weekdayOf(shiftDate(date, -1))}`}
            aria-label={`Previous day, ${weekdayOf(shiftDate(date, -1))}`}
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => setDate(shiftDate(date, 1))}
            title={`Next day — ${weekdayOf(shiftDate(date, 1))}`}
            aria-label={`Next day, ${weekdayOf(shiftDate(date, 1))}`}
          >
            ›
          </button>
        </div>

        <button type="button" onClick={() => setDate(today())} disabled={date === today()}>
          Today
        </button>

        <span className="muted daylabel">{weekdayOf(date)}</span>
      </div>

      {error && <p className="error">{error}</p>}

      {/* First load only: there is genuinely nothing to keep on screen. */}
      {!error && sessions === null && showSpinner && (
        <Loader label={`Loading timetable for ${date}…`} />
      )}

      <div className="content">
      {/* A hairline bar, not a spinner. Stepping a day is one query; a labelled
          spinner is too much ceremony for it wherever it is put, and it either
          covers the answer or shifts the layout. This takes no layout space,
          hides nothing, and the content below simply dims. */}
      {sessions !== null && showSpinner && (
        <div className="content-progress" role="status" aria-live="polite" aria-label={`Loading ${weekdayOf(date)}`} />
      )}

      {sessions?.length === 0 && (
        <div className={`empty${loading ? ' stale' : ''}`}>
          {/* Decorative: the heading below carries the meaning. */}
          <div className="empty-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M3 10h18M8 3v4M16 3v4" />
            </svg>
          </div>

          <h2>No lessons on {weekdayOf(date)}</h2>
          <p className="muted">{longDateOf(date)}</p>

          {/* Stepping a day at a time is the common move from an empty day, and
              it beats reopening the date picker for each try. */}
          <div className="empty-nav">
            <button type="button" onClick={() => setDate(shiftDate(date, -1))}>
              ← {weekdayOf(shiftDate(date, -1))}
            </button>
            <button type="button" onClick={() => setDate(today())} disabled={date === today()}>
              Today
            </button>
            <button type="button" onClick={() => setDate(shiftDate(date, 1))}>
              {weekdayOf(shiftDate(date, 1))} →
            </button>
          </div>

          {/* Behind a disclosure on purpose. Mounting the generator costs a
              term fetch plus a session query per class -- 5-8 requests, and a
              loader for each phase -- to render one line that, on a term
              already set up, says "nothing to do". An empty Friday is the
              common case and should cost nothing beyond the timetable query. */}
          {setupOpen ? (
            <GenerateSessions onGenerated={() => setReloadKey((k) => k + 1)} />
          ) : (
            <button type="button" className="linklike" onClick={() => setSetupOpen(true)}>
              Set up a term's lessons…
            </button>
          )}
        </div>
      )}

      {sessions && sessions.length > 0 && (
        <table className={loading ? 'stale' : undefined}>
          <thead>
            <tr>
              <th>Time</th>
              <th>Session</th>
              <th>Class</th>
              <th>Term</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => {
              const taken = s.attendance_taken === true;
              const cancelled = s.status === 'Cancelled';
              const upcoming = isFutureDate(s.session_date);
              return (
                <tr key={s.id}>
                  <td>{str(s.start_time, '—')}</td>
                  <td>{str(s.name)}</td>
                  <td>{classNames.get(s.class_id) ?? '—'}</td>
                  <td className="muted">{termByClass.get(s.class_id) || '…'}</td>
                  {/* Flagged in the list too, so a future register is obvious
                      before it is opened. */}
                  <td>
                    {cancelled ? (
                      <span className="pill off">Cancelled</span>
                    ) : taken ? (
                      <span className="pill done">Attendance taken</span>
                    ) : upcoming ? (
                      <span className="pill todo">Upcoming</span>
                    ) : (
                      <span className="pill todo">Not taken</span>
                    )}
                  </td>
                  <td>
                    <button type="button" onClick={() => setSelected(s.id)}>
                      {cancelled || taken ? 'Review' : upcoming ? 'Open' : 'Take attendance'}
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
