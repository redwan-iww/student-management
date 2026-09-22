// Builds a term's timetable: expands every class's weekly pattern into dated
// Class_Sessions rows.
//
// Why this lives in the app rather than only in scripts/seed-dummy.mjs: the
// script needs an OAuth token, whereas a web tab already holds an authenticated
// CRM session. A coordinator setting up a term should not have to mint
// credentials to do step 5 of the runbook -- see docs/new-term-workflow.md,
// which calls this step "pure mechanism" that "should not be done by hand".
//
// Re-running is safe. Existing (date, start_time) pairs per class are read
// first and skipped, matching the uq_session_per_class_date constraint, so a
// half-finished run can simply be repeated.

import { useEffect, useState } from 'react';

import { Loader, useDelayed } from './Loader';
import {
  BULK_LIMIT,
  describeError,
  createClassSessionBatch,
  getActiveTerms,
  getClassesForTerm,
  getSessionKeysForClass,
  plannedSessions,
  str,
  type PlannedSession,
  type Term,
} from '../data/client';

type Preview =
  | { kind: 'none' }
  | { kind: 'counting' }
  | { kind: 'ready'; lessons: number; classes: number; existing: number; firstDate: string; lastDate: string }
  | { kind: 'failed' };

type Run =
  | { kind: 'idle' }
  | { kind: 'working'; done: number; total: number; label: string }
  | { kind: 'done'; created: number; skipped: number }
  | { kind: 'error'; message: string };

export function GenerateSessions({ onGenerated }: { onGenerated: () => void }) {
  const [terms, setTerms] = useState<Term[] | null>(null);
  const [termId, setTermId] = useState<number | null>(null);
  const [run, setRun] = useState<Run>({ kind: 'idle' });
  // What clicking would actually do, worked out up front: 'what does this mean'
  // is answered far better by a concrete count than by any wording.
  const [preview, setPreview] = useState<Preview>({ kind: 'none' });

  // One flag for both fetch phases, so they cannot chain two separate spinners.
  const preparingSlow = useDelayed(terms === null || preview.kind === 'counting');

  useEffect(() => {
    let cancelled = false;
    getActiveTerms()
      .then((recs) => {
        if (cancelled) return;
        setTerms(recs);
        if (recs[0]) setTermId(recs[0].id);
      })
      .catch((err: unknown) => {
        if (!cancelled) setRun({ kind: 'error', message: describeError(err) });
      });
    return () => { cancelled = true; };
  }, []);

  // Recount whenever the chosen term changes, so the button's effect is stated
  // in records and dates before it is pressed rather than after.
  useEffect(() => {
    if (!termId) return;
    let cancelled = false;
    setPreview({ kind: 'counting' });

    (async () => {
      try {
        const classes = await getClassesForTerm(termId);

        // Only classes that actually declare a pattern need checking, and their
        // session lookups are independent -- so they go in parallel. Awaiting
        // them one at a time made this six round trips deep for a six-class
        // term, which is what made the wait long enough to need a spinner.
        const scheduled = classes
          .map((klass) => ({ klass, planned: plannedSessions(klass) }))
          .filter((c) => c.planned.length > 0);

        const keySets = await Promise.all(
          scheduled.map((c) => getSessionKeysForClass(c.klass.id)),
        );

        let lessons = 0;
        let existing = 0;
        const withPattern = scheduled.length;
        const dates: string[] = [];

        scheduled.forEach((c, i) => {
          const already = keySets[i]!;
          const startTime = str(c.klass.start_time);
          for (const s of c.planned) {
            if (already.has(`${s.date}|${startTime}`)) existing += 1;
            else { lessons += 1; dates.push(s.date); }
          }
        });
        if (cancelled) return;
        dates.sort();
        setPreview({
          kind: 'ready',
          lessons,
          classes: withPattern,
          existing,
          firstDate: dates[0] ?? '',
          lastDate: dates[dates.length - 1] ?? '',
        });
      } catch {
        if (!cancelled) setPreview({ kind: 'failed' });
      }
    })();

    return () => { cancelled = true; };
  }, [termId]);

  async function generate() {
    if (!termId) return;
    setRun({ kind: 'working', done: 0, total: 0, label: 'Reading classes…' });
    try {
      const classes = await getClassesForTerm(termId);

      // Work out the whole plan before writing anything, so the progress total
      // is real rather than a guess that creeps upward.
      const scheduled = classes
        .map((klass) => ({ klass, planned: plannedSessions(klass) }))
        .filter((c) => c.planned.length > 0);

      // Parallel for the same reason as the preview above: independent reads.
      const keySets = await Promise.all(
        scheduled.map((c) => getSessionKeysForClass(c.klass.id)),
      );

      const plan: PlannedSession[] = [];
      let skipped = 0;
      scheduled.forEach((c, i) => {
        const existing = keySets[i]!;
        const startTime = str(c.klass.start_time);
        for (const s of c.planned) {
          if (existing.has(`${s.date}|${startTime}`)) skipped += 1;
          else plan.push({ klass: c.klass, date: s.date, sequenceNo: s.sequenceNo });
        }
      });

      if (plan.length === 0) {
        setRun({ kind: 'done', created: 0, skipped });
        return;
      }

      // One call per BULK_LIMIT records rather than one per record: 100 lessons
      // is a single request. Batches still go one after another so a failure
      // stops at a known point instead of leaving an unknown subset written.
      let written = 0;
      for (let i = 0; i < plan.length; i += BULK_LIMIT) {
        const batch = plan.slice(i, i + BULK_LIMIT);
        setRun({
          kind: 'working',
          done: written,
          total: plan.length,
          label: `batch of ${batch.length}`,
        });
        written += await createClassSessionBatch(batch);
      }
      setRun({ kind: 'working', done: written, total: plan.length, label: 'finishing' });

      setRun({ kind: 'done', created: written, skipped });
      onGenerated();
    } catch (err) {
      setRun({ kind: 'error', message: describeError(err) });
    }
  }

  if (run.kind === 'error') return <p className="error">{run.message}</p>;

  // Two sequential fetches -- terms, then the per-term count -- used to show a
  // loader each, so arriving on an empty day flashed one after the other.
  // Treated as a single "preparing" state, and rendered as nothing at all until
  // it is slow enough to be worth mentioning: the surrounding empty state is
  // already meaningful without this block.
  if (terms === null || preview.kind === 'counting') {
    return preparingSlow ? <Loader label="Checking this term's lessons…" /> : null;
  }

  if (terms.length === 0)
    return <p className="muted">No open or running terms, so there is nothing to set up.</p>;

  if (run.kind === 'working') {
    const pct = run.total ? Math.round((run.done / run.total) * 100) : 0;
    return (
      <div className="genbox">
        <Loader
          inline
          label={run.total ? `Creating lessons — ${run.done} of ${run.total} written (${run.label})` : run.label}
        />
        <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <p className="muted">Leave this tab open until it finishes.</p>
      </div>
    );
  }

  if (run.kind === 'done') {
    return (
      <div className="genbox">
        <p>
          Done — created <strong>{run.created}</strong> lesson{run.created === 1 ? '' : 's'}
          {run.skipped > 0 && <> · {run.skipped} already existed and were left alone</>}.
          {' '}Pick a date inside the term to take a register.
        </p>
        <button type="button" onClick={() => setRun({ kind: 'idle' })}>Set up another term</button>
      </div>
    );
  }

  // Nothing to do for this term: an empty date is then just a day nobody
  // teaches, not a setup step that was missed. Collapse to one line rather than
  // presenting a full explainer for a job already finished -- but keep the term
  // picker, since another term may still need generating.
  if (preview.kind === 'ready' && preview.lessons === 0 && preview.existing > 0) {
    return (
      <p className="muted generated">
        All {preview.existing} lessons already exist for{' '}
        <select value={termId ?? ''} onChange={(e) => setTermId(Number(e.target.value))}>
          {terms.map((t) => (
            <option key={t.id} value={t.id}>
              {str(t.name, String(t.id))}
            </option>
          ))}
        </select>{' '}
        — pick another term above to set one up.
      </p>
    );
  }

  return (
    <div className="genbox">
      <h2>Set up this term's lessons</h2>
      <p>
        Each class knows <em>when it meets</em> — for example “Mondays and
        Wednesdays, 09:00–10:30, from 7 Sep to 11 Dec”. That's a rule, not a list
        of dates. Attendance is marked one lesson at a time, so each of those
        dates has to exist as its own lesson before a register can be taken.
      </p>
      <p>This creates them. Running it twice is harmless — dates that already exist are left alone.</p>

      <div className="toolbar">
        <label>
          Term{' '}
          <select value={termId ?? ''} onChange={(e) => setTermId(Number(e.target.value))}>
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {str(t.name, String(t.id))} ({str(t.start_date, '?')} → {str(t.end_date, '?')})
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={generate}
          disabled={!termId || preview.kind !== 'ready' || preview.lessons === 0}
        >
          {preview.kind === 'ready' && preview.lessons > 0
            ? `Create ${preview.lessons} lesson${preview.lessons === 1 ? '' : 's'}`
            : 'Create lessons'}
        </button>
      </div>

      {preview.kind === 'failed' && (
        <p className="error">Could not read this term's classes.</p>
      )}
      {preview.kind === 'ready' && (
        <p className="muted preview">
          {preview.classes === 0 ? (
            <>
              None of this term's classes say which days they meet, so there is
              nothing to create. Add meeting days to the classes first.
            </>
          ) : preview.lessons === 0 ? (
            <>Every lesson for this term already exists ({preview.existing} in total). Nothing to do.</>
          ) : (
            <>
              Will create <strong>{preview.lessons} lessons</strong> across{' '}
              {preview.classes} class{preview.classes === 1 ? '' : 'es'}, from{' '}
              {preview.firstDate} to {preview.lastDate}
              {preview.existing > 0 && <> · {preview.existing} already exist and will be skipped</>}.
            </>
          )}
        </p>
      )}
    </div>
  );
}
