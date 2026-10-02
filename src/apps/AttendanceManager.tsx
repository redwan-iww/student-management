import { useCallback, useEffect, useMemo, useState } from 'react';
import { ZOHO_MODULES } from '../generated/types';
import { AttendanceSheet } from '../components/AttendanceSheet';
import { Loader, useDelayed } from '../components/Loader';
import { GenerateSessions } from '../components/GenerateSessions';
import { Avatar, Badge, Banner, Button, Card, Drawer, EmptyState, Icon } from '../components/ui';
import { sessionTone, shortDays } from '../components/status';
import {
  describeError,
  getActiveTerms,
  getClassesByIds,
  getSessionsBetween,
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

/** '20 Sep' -- a date heading inside a list that already names the year. */
const shortDateOf = (isoDate: string) =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

/** 'October 2026'. */
const monthOf = (isoDate: string) =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/**
 * The date one step away, for the spans that are pure arithmetic on a date.
 *
 * Pulled out of the component so the guard that decides whether a step is
 * allowed and the handler that performs it can call the same function. When
 * they were separate the two drifted: the arrow disabled itself on a
 * different date from the one it would have moved to.
 */
const stepDate = (span: Span, isoDate: string, direction: -1 | 1) => {
  if (span === 'day') return shiftDate(isoDate, direction);
  if (span === 'week') return shiftDate(isoDate, 7 * direction);
  const d = new Date(`${isoDate}T00:00:00Z`);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + direction, 1));
  // Clamped to the last day, so stepping from the 31st does not skip a short
  // month by overflowing into the next one.
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), last));
  return target.toISOString().slice(0, 10);
};

/** The days a span covers from a given date -- the period itself, not the
 *  whole weeks the calendar pads it out to. */
const periodOf = (span: Span, isoDate: string) =>
  span === 'day'
    ? { from: isoDate, to: isoDate }
    : span === 'week'
      ? { from: startOfWeek(isoDate), to: endOfWeek(isoDate) }
      : { from: startOfMonth(isoDate), to: endOfMonth(isoDate) };

/**
 * How much of the timetable is on screen, within the chosen term.
 *
 * A day answers "what am I teaching now", a week "what is left this week", a
 * month "how is the term going". They are the same view over different
 * bounds, so they are one span rather than three screens.
 *
 * There was a fourth, Term. The term picker took over naming and choosing the
 * term, which left the span doing only "the whole thing at once" -- fourteen
 * week-rows and some three hundred lessons, too much to read, and reachable
 * in three steps of Month anyway. What it was really for, "which registers
 * did nobody take", is a filter and not a span.
 */
type Span = 'day' | 'week' | 'month';

/**
 * The weekday a week starts on, 1 = Monday, as getUTCDay numbers it with
 * Sunday at 0. Monday because the display locale is en-GB and the class
 * patterns -- Mon+Wed, Tue+Thu, Sat -- all fall inside one Monday-start week.
 * One constant, because a school on a Saturday-start week changes only this.
 */
const WEEK_STARTS_ON = 1;

const startOfWeek = (isoDate: string) => {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return shiftDate(isoDate, -((day - WEEK_STARTS_ON + 7) % 7));
};

const endOfWeek = (isoDate: string) => shiftDate(startOfWeek(isoDate), 6);

const startOfMonth = (isoDate: string) => isoDate.slice(0, 8) + '01';

const endOfMonth = (isoDate: string) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10);
};

/**
 * Web-tab entry point for attendance.
 *
 * A detail-view widget would have been handed a session id. A web tab is not,
 * so the tab opens on today's timetable and the user picks the session.
 */
export function AttendanceManager() {
  const [date, setDate] = useState(today);
  // A week, not a day. The tab opens on today either way, but a day shows one
  // or two lessons and says nothing about what is around them -- most of the
  // reasons to open this screen ("what have I not marked", "when is that
  // class") are answered by the week today sits in, and the day is one click
  // away from it.
  const [span, setSpan] = useState<Span>('week');
  // Terms, read once and only when a term span is first asked for: three of
  // the four spans are arithmetic on the date and need nothing fetched.
  const [terms, setTerms] = useState<RawRecord[] | null>(null);
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
  // The class behind each session, by id. Resolved separately because a
  // session carries only a Class lookup -- its term, room and weekly pattern
  // all live on the class, and the details panel wants all three.
  const [classById, setClassById] = useState<Map<string, RawRecord>>(new Map());
  // The session whose details are open, if any. Distinct from `selected`,
  // which is the register itself: reading about a lesson and marking one are
  // different acts and only the second should replace the timetable.
  const [details, setDetails] = useState<RawRecord | null>(null);

  const F = ZOHO_MODULES.class_sessions.fields;
  const C = ZOHO_MODULES.classes.fields;
  const T = ZOHO_MODULES.terms.fields;

  // Read once, on mount. It used to wait until a term span was asked for --
  // three of the four spans are arithmetic and need nothing fetched -- but
  // the stepping bounds need the first and last term whatever is on screen,
  // and a disabled arrow that only knows it is disabled once you switch to
  // Term is worse than one request.
  useEffect(() => {
    let cancelled = false;
    getActiveTerms()
      .then((recs) => { if (!cancelled) setTerms(recs); })
      .catch((err: unknown) => { if (!cancelled) setError(describeError(err)); });
    return () => { cancelled = true; };
  }, []);

  /**
   * The dates on screen, and what to call them.
   *
   * Every span is arithmetic on the date, so the range is always known at
   * once -- nothing here waits on a fetch.
   */
  const range = useMemo((): {
    /** What to fetch and what the calendar draws -- always whole weeks. */
    from: string;
    to: string;
    /** What the label names. Narrower than from/to wherever the period does
     *  not begin on a Monday: October starts on a Thursday, so the grid also
     *  draws the three September days that share that week. They are real
     *  days with real lessons, so they are fetched and shown, just dimmed. */
    focusFrom: string;
    focusTo: string;
    label: string;
  } => {
    if (span === 'day') {
      return { from: date, to: date, focusFrom: date, focusTo: date, label: longDateOf(date) };
    }
    if (span === 'week') {
      const from = startOfWeek(date);
      const to = shiftDate(from, 6);
      return {
        from, to, focusFrom: from, focusTo: to,
        label: `${shortDateOf(from)} – ${shortDateOf(to)}`,
      };
    }
    const focusFrom = startOfMonth(date);
    const focusTo = endOfMonth(date);
    return {
      from: startOfWeek(focusFrom),
      to: endOfWeek(focusTo),
      focusFrom,
      focusTo,
      label: monthOf(date),
    };
  }, [span, date]);

  /**
   * The calendar: whole weeks of days, each with the lessons that fall on it.
   *
   * Built from `range` rather than from the sessions, so a day with nothing
   * on it still gets a cell. A timetable with Tuesday missing because nobody
   * teaches on Tuesday is a timetable you cannot count along.
   */
  const weeks = useMemo(() => {
    if (span === 'day') return [];
    const byDate = new Map<string, RawRecord[]>();
    for (const sess of sessions ?? []) {
      const d = str(sess[F.session_date]);
      const list = byDate.get(d);
      if (list) list.push(sess);
      else byDate.set(d, [sess]);
    }
    const out: { date: string; dim: boolean; sessions: RawRecord[] }[][] = [];
    let cursor = range.from;
    while (cursor <= range.to) {
      const week: { date: string; dim: boolean; sessions: RawRecord[] }[] = [];
      for (let i = 0; i < 7; i += 1) {
        week.push({
          date: cursor,
          dim: cursor < range.focusFrom || cursor > range.focusTo,
          sessions: byDate.get(cursor) ?? [],
        });
        cursor = shiftDate(cursor, 1);
      }
      out.push(week);
    }
    return out;
  }, [span, sessions, range.from, range.to, range.focusFrom, range.focusTo, F.session_date]);

  // Only surface a spinner once the wait is long enough to notice; a fast
  // fetch would otherwise flash one and read as a glitch.
  const showSpinner = useDelayed(loading);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSelected(null);
    setError(null);

    getSessionsBetween(range.from, range.to)
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
        setClassById(classes);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(describeError(err));
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [range.from, range.to, reloadKey, F.class]);

  // Taking a register changes the row we came from. The list is state
  // fetched when the day loaded, so without this it still reads "Not taken"
  // until something refetches -- and the only trigger for that is changing
  // date or reloading the tab. Patch it locally instead of refetching the
  // day: the value is already known here, so a round trip would buy nothing
  // but a flash of the stale-dim bar.
  /** The term the date falls in, or null in the gap between two. */
  const currentTerm = useMemo(
    () =>
      (terms ?? []).find(
        (t) => str(t[T.start_date]) <= date && date <= str(t[T.end_date]),
      ) ?? null,
    [terms, date, T.start_date, T.end_date],
  );

  /**
   * How far the day, week and month views may travel.
   *
   * The term, not the school's whole calendar. A term is the unit the register
   * belongs to -- its classes, its enrolments, its sessions all end with it --
   * so walking out of one by stepping a day is leaving the thing you are
   * working on, silently, without having asked to. Changing term is the term
   * picker's job, and it is one control away.
   *
   * Null until the terms arrive, or while the date sits in a gap: in both
   * cases there is no term to be bounded by, and the arrows stay enabled
   * rather than disabling themselves on a fact nobody knows.
   */
  const bounds = useMemo(
    () =>
      currentTerm
        ? { from: str(currentTerm[T.start_date]), to: str(currentTerm[T.end_date]) }
        : null,
    [currentTerm, T.start_date, T.end_date],
  );

  /** One step back or forward, in whatever unit is on screen. */
  const step = useCallback(
    (direction: -1 | 1) => setDate((d) => stepDate(span, d, direction)),
    [span],
  );

  /**
   * Is there anywhere to step to?
   *
   * The edges of the term on screen. Stepping a day cannot walk out of the
   * term you are working on; the picker is how you leave it, and it says
   * which term you are going to.
   */
  const canStep = useCallback(
    (direction: -1 | 1) => {
      if (bounds === null) return true;
      // Overlap, not containment: the month a term ends in is still the last
      // month worth showing, even though most of it falls outside the term.
      const period = periodOf(span, stepDate(span, date, direction));
      return period.from <= bounds.to && period.to >= bounds.from;
    },
    [span, date, bounds],
  );

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
          Back to {range.label}
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
          <input
            type="date"
            value={date}
            min={bounds?.from}
            max={bounds?.to}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>

        {/* Stepping is the common move -- most days are empty or hold one
            lesson -- so it belongs next to the field rather than only in the
            empty state. The arrows move by whatever unit is on screen, so the
            control does not change meaning when the span does. */}
        <div className="seg">
          <Button
            onClick={() => step(-1)}
            disabled={!canStep(-1)}
            title={`Previous ${span}`}
            aria-label={`Previous ${span}`}
          >
            <Icon name="chevron-left" />
          </Button>
          <Button
            onClick={() => step(1)}
            disabled={!canStep(1)}
            title={`Next ${span}`}
            aria-label={`Next ${span}`}
          >
            <Icon name="chevron-right" />
          </Button>
        </div>

        <Button
          onClick={() => setDate(today())}
          disabled={
            date === today() ||
            (bounds !== null && (today() < bounds.from || today() > bounds.to))
          }
          title={
            bounds !== null && (today() < bounds.from || today() > bounds.to)
              ? `Today is not in ${str(currentTerm?.[T.name] ?? 'this term')} — pick the term it falls in`
              : undefined
          }
        >
          Today
        </Button>

        {/* How much of the chosen term to show at once. A day to teach from,
            a week to plan, a month to see how the term is going. */}
        <div className="seg">
          {(['day', 'week', 'month'] as const).map((s) => (
            <Button
              key={s}
              className={span === s ? 'is-on' : undefined}
              aria-pressed={span === s}
              onClick={() => setSpan(s)}
            >
              {s[0]?.toUpperCase() + s.slice(1)}
            </Button>
          ))}
        </div>

        {/* Always on, not only under the Term span: it is the frame every
            other span sits inside, and the only way out of one term into
            another now that stepping stops at the term's edge. */}
        {terms !== null && terms.length > 0 && (
          <label>
            <span className="bulk-label">Term</span>
            <select
              value={currentTerm?.id ?? ''}
              onChange={(e) => {
                const picked = terms.find((t) => t.id === e.target.value);
                if (!picked) return;
                const from = str(picked[T.start_date]);
                const to = str(picked[T.end_date]);
                // Today if today is in it, its first day otherwise: switching
                // to the term in progress should open on the day you teach,
                // not on its September start.
                setDate(today() >= from && today() <= to ? today() : from);
              }}
            >
              {/* Only while the date sits in a gap between terms, so the
                  control has something truthful to show rather than naming a
                  term that is not on screen. */}
              <option value="">Between terms…</option>
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {str(t[T.name])}
                </option>
              ))}
            </select>
          </label>
        )}

        <span className="muted daylabel">
          <Icon name="calendar" size={15} />
          {range.label}
        </span>
      </div>

      {details && (() => {
        const klass = classById.get(refId(details[F.class]) ?? '');
        const taken = details[F.attendance_taken] === true;
        const cancelled = str(details[F.status]) === 'Cancelled';
        const upcoming = isFutureDate(str(details[F.session_date]));
        const tone = sessionTone(cancelled, taken, upcoming);
        const days = klass ? (klass[C.meeting_days] as string[] | undefined) ?? [] : [];
        return (
          <Drawer
            title={refName(details[F.class]) || str(details[F.name])}
            subtitle={longDateOf(str(details[F.session_date]))}
            onClose={() => setDetails(null)}
          >
            <dl className="facts">
              <dt>Status</dt>
              <dd><Badge tone={tone.tone} dot>{tone.label}</Badge></dd>

              <dt>Time</dt>
              <dd>
                {[str(details[F.start_time]), str(details[F.end_time])]
                  .filter(Boolean)
                  .join('–') || '—'}
              </dd>

              <dt>Date</dt>
              <dd>
                {weekdayOf(str(details[F.session_date]))},{' '}
                {longDateOf(str(details[F.session_date]))}
              </dd>

              <dt>Term</dt>
              <dd>{klass ? refName(klass[C.term]) || '—' : '…'}</dd>

              <dt>Room</dt>
              <dd>{klass ? str(klass[C.room], '—') : '…'}</dd>

              <dt>Class meets</dt>
              <dd>{days.length > 0 ? shortDays(days) : klass ? 'No days set' : '…'}</dd>

              {/* The generated name. Kept here rather than in the row, where it
                  repeated the class and the date either side of it. */}
              <dt>Session</dt>
              <dd className="muted">{str(details[F.name], '—')}</dd>

              {str(details[F.notes]) && (
                <>
                  <dt>Notes</dt>
                  <dd>{str(details[F.notes])}</dd>
                </>
              )}
            </dl>

            <Button
              variant="primary"
              onClick={() => {
                const id = details.id;
                setDetails(null);
                setSelected(id);
              }}
            >
              {cancelled || taken ? 'Review the register' : upcoming ? 'Open the register' : 'Take attendance'}
              <Icon name="chevron-right" />
            </Button>
          </Drawer>
        );
      })()}

      {error && <Banner tone="error">{error}</Banner>}

      {/* First load only: there is genuinely nothing to keep on screen. */}
      {!error && sessions === null && showSpinner && (
        <Loader label={`Loading timetable for ${range.label}…`} />
      )}

      <div className="content">
      {/* A hairline bar, not a spinner. Stepping a day is one query; a labelled
          spinner is too much ceremony for it wherever it is put, and it either
          covers the answer or shifts the layout. This takes no layout space,
          hides nothing, and the content below simply dims. */}
      {sessions !== null && showSpinner && (
        <div className="content-progress" role="status" aria-live="polite" aria-label={`Loading ${range.label}`} />
      )}

      {sessions?.length === 0 && (
        <EmptyState
          icon="calendar"
          title={span === 'day' ? `No lessons on ${weekdayOf(date)}` : 'No lessons in this range'}
          detail={range.label}
          className={loading ? 'stale' : undefined}
        >
          {/* Stepping is the common move from an empty range, and it beats
              reopening the date picker for each try. On a day the buttons name
              the weekday they land on; over a longer span there is no single
              weekday to name, so they name the unit instead. */}
          <div className="empty-nav">
            <Button onClick={() => step(-1)} disabled={!canStep(-1)}>
              <Icon name="arrow-left" />
              {span === 'day' ? weekdayOf(shiftDate(date, -1)) : `Previous ${span}`}
            </Button>
            <Button
              onClick={() => setDate(today())}
              disabled={
                date === today() ||
                (bounds !== null && (today() < bounds.from || today() > bounds.to))
              }
            >
              Today
            </Button>
            <Button onClick={() => step(1)} disabled={!canStep(1)}>
              {span === 'day' ? weekdayOf(shiftDate(date, 1)) : `Next ${span}`}
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

      {/* One day is one column of lessons, which is a list. The table stays
          for it: there is room for the register button on each row, and that
          is the thing this screen exists to do. */}
      {span === 'day' && sessions && sessions.length > 0 && (
        <Card>
        <table className={loading ? 'stale' : undefined}>
          <thead>
            {/* Four columns, not six. The Session column held the session's
                name, which is its class and its date joined -- the class is
                the next column along and the date is the heading above the
                group, so it said nothing twice. Term went with it: it is the
                same for every row of a term view and is one line in the panel
                behind the class name. */}
            <tr>
              <th>Time</th>
              <th>Class</th>
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
                    {/* The name opens the lesson, the button at the end takes
                        the register. Same split as a class card on the other
                        tab: the row's subject is a thing to read about, the
                        action is a thing to do. */}
                    <button
                      type="button"
                      className="cell-stack row-open"
                      onClick={() => setDetails(s)}
                      title="Lesson details"
                    >
                      <Avatar name={refName(s[F.class]) || str(s[F.name])} />
                      <span className="cell-title">{refName(s[F.class]) || '—'}</span>
                    </button>
                  </td>
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

      {/* Anything wider reads across, not down. Days are columns and lessons
          stack inside them, so a week is seven short lists side by side rather
          than one long one you count through. Whole weeks always, so a column
          means the same weekday on every row. */}
      {span !== 'day' && sessions && sessions.length > 0 && (
        <div className={`cal${loading ? ' stale' : ''}`}>
          <div className="cal-head" aria-hidden="true">
            {weeks[0]?.map((cell) => (
              <span key={cell.date}>{weekdayOf(cell.date).slice(0, 3)}</span>
            ))}
          </div>

          {weeks.map((week) => (
            <div className="cal-week" key={week[0]?.date}>
              {week.map((cell) => (
                <div
                  key={cell.date}
                  className={[
                    'cal-day',
                    cell.dim ? 'cal-dim' : '',
                    cell.date === today() ? 'cal-today' : '',
                  ].filter(Boolean).join(' ')}
                >
                  {/* The weekday rides on the element for the stacked
                      layout below 52rem, where the column header that would
                      otherwise carry it is hidden. */}
                  <span className="cal-date" data-weekday={weekdayOf(cell.date)}>
                    {Number(cell.date.slice(8, 10))}
                    {cell.date === today() && <span className="cal-today-tag">Today</span>}
                  </span>

                  {cell.sessions.map((sess) => {
                    const taken = sess[F.attendance_taken] === true;
                    const cancelled = str(sess[F.status]) === 'Cancelled';
                    const upcoming = isFutureDate(str(sess[F.session_date]));
                    const tone = sessionTone(cancelled, taken, upcoming);
                    return (
                      <button
                        type="button"
                        key={sess.id}
                        className={`cal-item tone-${tone.tone}`}
                        onClick={() => setDetails(sess)}
                        title={`${str(sess[F.start_time])} ${refName(sess[F.class])} — ${tone.label}`}
                      >
                        <span className="cal-time">{str(sess[F.start_time], '—')}</span>
                        <span className="cal-name">{refName(sess[F.class]) || '—'}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      </div>
    </section>
  );
}
