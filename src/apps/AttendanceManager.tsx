import { useCallback, useEffect, useState } from 'react';
import { ZOHO_MODULES } from '../generated/types';
import { AttendanceSheet } from '../components/AttendanceSheet';
import { Loader, useDelayed } from '../components/Loader';
import { GenerateSessions } from '../components/GenerateSessions';
import { Avatar, Badge, Banner, Button, Card, EmptyState, Icon } from '../components/ui';
import { sessionTone } from '../components/status';
import {
  describeError,
  getClassesByIds,
  getSessionsForDate,
  isFutureDate,
  refId,
  orgToday,
  refName,
  str,
  type RawRecord,
} from '../zoho/client';

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
  const [sessions, setSessions] = useState<RawRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
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
  const [termByClass, setTermByClass] = useState<Map<string, string>>(new Map());

  const F = ZOHO_MODULES.class_sessions.fields;
  const C = ZOHO_MODULES.classes.fields;

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

        const classIds = recs.map((r) => refId(r[F.class]) ?? '').filter(Boolean);
        if (classIds.length === 0) return;
        const classes = await getClassesByIds(classIds);
        if (cancelled) return;

        const next = new Map<string, string>();
        for (const [id, klass] of classes) next.set(id, refName(klass[C.term]));
        setTermByClass(next);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(describeError(err));
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [date, reloadKey, F.class, C.term]);

  // Taking a register changes the row we came from. The list is state
  // fetched when the day loaded, so without this it still reads "Not taken"
  // until something refetches -- and the only trigger for that is changing
  // date or reloading the tab. Patch it locally instead of refetching the
  // day: the value is already known here, so a round trip would buy nothing
  // but a flash of the stale-dim bar.
  const handleSaved = useCallback(
    (attendanceTaken: boolean) => {
      setSessions((prev) =>
        prev?.map((s) =>
          s.id === selected ? { ...s, [F.attendance_taken]: attendanceTaken } : s,
        ) ?? prev,
      );
    },
    [selected, F.attendance_taken],
  );

  if (selected) {
    return (
      <>
        <Button variant="ghost" className="back" onClick={() => setSelected(null)}>
          <Icon name="arrow-left" />
          Back to {date}
        </Button>
        <AttendanceSheet sessionId={selected} onSaved={handleSaved} />
      </>
    );
  }

  return (
    <section>
      <div className="toolbar toolbar-page">
        <label>
          <span className="bulk-label">Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>

        {/* Stepping is the common move -- most days are empty or hold one
            lesson -- so it belongs next to the field rather than only in the
            empty state. Labelled with the weekday they land on, since an
            unadorned arrow says nothing about where it goes. */}
        <div className="seg">
          <Button
            onClick={() => setDate(shiftDate(date, -1))}
            title={`Previous day — ${weekdayOf(shiftDate(date, -1))}`}
            aria-label={`Previous day, ${weekdayOf(shiftDate(date, -1))}`}
          >
            <Icon name="chevron-left" />
          </Button>
          <Button
            onClick={() => setDate(shiftDate(date, 1))}
            title={`Next day — ${weekdayOf(shiftDate(date, 1))}`}
            aria-label={`Next day, ${weekdayOf(shiftDate(date, 1))}`}
          >
            <Icon name="chevron-right" />
          </Button>
        </div>

        <Button onClick={() => setDate(today())} disabled={date === today()}>
          Today
        </Button>

        <span className="muted daylabel">
          <Icon name="calendar" size={15} />
          {weekdayOf(date)}
        </span>
      </div>

      {error && <Banner tone="error">{error}</Banner>}

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
        <EmptyState
          icon="calendar"
          title={`No lessons on ${weekdayOf(date)}`}
          detail={longDateOf(date)}
          className={loading ? 'stale' : undefined}
        >
          {/* Stepping a day at a time is the common move from an empty day, and
              it beats reopening the date picker for each try. */}
          <div className="empty-nav">
            <Button onClick={() => setDate(shiftDate(date, -1))}>
              <Icon name="arrow-left" />
              {weekdayOf(shiftDate(date, -1))}
            </Button>
            <Button onClick={() => setDate(today())} disabled={date === today()}>
              Today
            </Button>
            <Button onClick={() => setDate(shiftDate(date, 1))}>
              {weekdayOf(shiftDate(date, 1))}
              <Icon name="arrow-right" />
            </Button>
          </div>

          {/* Behind a disclosure on purpose. Mounting the generator costs a
              term fetch plus a session query per class -- 5-8 requests, and a
              loader for each phase -- to render one line that, on a term
              already set up, says "nothing to do". An empty Friday is the
              common case and should cost nothing beyond the timetable query. */}
          {setupOpen ? (
            <GenerateSessions onGenerated={() => setReloadKey((k) => k + 1)} />
          ) : (
            <Button variant="link" onClick={() => setSetupOpen(true)}>
              Set up a term's lessons…
            </Button>
          )}
        </EmptyState>
      )}

      {sessions && sessions.length > 0 && (
        <Card>
        <table className={loading ? 'stale' : undefined}>
          <thead>
            <tr>
              <th>Time</th>
              <th>Session</th>
              <th>Class</th>
              <th>Term</th>
              <th>Status</th>
              <th className="actions" />
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => {
              const taken = s[F.attendance_taken] === true;
              const cancelled = str(s[F.status]) === 'Cancelled';
              const upcoming = isFutureDate(str(s[F.session_date]));
              // Flagged in the list too, so a future register is obvious
              // before it is opened.
              const status = sessionTone(cancelled, taken, upcoming);
              return (
                <tr key={s.id}>
                  <td>
                    <span className="cell-mono">
                      <Icon name="clock" size={14} />
                      {str(s[F.start_time], '—')}
                    </span>
                  </td>
                  <td>
                    <div className="cell-stack">
                      <Avatar name={str(s[F.name])} />
                      <span className="cell-title">{str(s[F.name])}</span>
                    </div>
                  </td>
                  <td>{refName(s[F.class]) || '—'}</td>
                  <td className="muted">{termByClass.get(refId(s[F.class]) ?? '') || '…'}</td>
                  <td>
                    <Badge tone={status.tone} dot>{status.label}</Badge>
                  </td>
                  <td className="actions">
                    <Button variant="ghost" onClick={() => setSelected(s.id)}>
                      {cancelled || taken ? 'Review' : upcoming ? 'Open' : 'Take attendance'}
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
    </section>
  );
}
