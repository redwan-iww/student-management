// Setup: create and edit the records the other two pages depend on.
//
// Ordered by docs/new-term-workflow.md rather than alphabetically, because the
// dependencies are real -- a class needs a course and a term to exist first.
// The sidebar therefore reads top to bottom as the order you would actually
// work in when opening a term.
//
// Every form is generated from the field metadata in db-types, so this file
// contains no per-entity markup: adding a column to schema/model.yaml surfaces
// it here automatically.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader, useDelayed } from '../components/Loader';
import {
  DISPLAY_COLUMN,
  FIELDS,
  TABLE_LABELS,
  type TableName,
} from '../generated/db-types';
import {
  draftFromRow,
  emptyDraft,
  RecordForm,
  toPayload,
  type Draft,
  type RefRows,
} from '../components/RecordForm';
import { describeError } from '../data/client';
import { counts as fetchCounts, insert, remove, select, update } from '../data/api';

/**
 * Setup order, following the runbook. Terms and programs first because nothing
 * depends on them; attendance last because everything else does.
 */
const SECTIONS: Array<{ heading: string; tables: TableName[] }> = [
  { heading: 'Calendar & catalog', tables: ['terms', 'programs', 'courses'] },
  { heading: 'Delivery', tables: ['classes', 'class_sessions', 'allocations'] },
  { heading: 'People', tables: ['teachers', 'households', 'students'] },
  { heading: 'Intake', tables: ['admissions', 'enrollments', 'attendance'] },
];

// The admin page is deliberately generic, so rows are handled as bags keyed by
// column name rather than as one of the twelve concrete row types.
type Row = Record<string, unknown> & { id: number };
const asRows = (rows: unknown): Row[] => rows as Row[];

/**
 * What must exist before a table can take a record, read off the schema.
 *
 * A required reference is a hard dependency -- the database will reject the
 * insert without it -- so those tables are unreachable until their targets have
 * rows. Optional references are left out: a course with no program is legal,
 * so blocking Courses on Programs would invent a rule the schema does not have.
 */
const PREREQUISITES: Record<TableName, TableName[]> = Object.fromEntries(
  (Object.keys(FIELDS) as TableName[]).map((table) => [
    table,
    [
      ...new Set(
        FIELDS[table]
          .filter((f) => f.type === 'reference' && f.required && f.ref)
          .map((f) => f.ref as TableName),
      ),
    ],
  ]),
) as Record<TableName, TableName[]>;

// ---------------------------------------------------------------------------
// Term length
//
// Terms are thought about in days -- "a 70-day term", "a 50-day term" -- but
// the schema stores two dates, so the form made you do the arithmetic both
// ways. This shows the length and lets you set it, writing back the end date.
// Inclusive, so 2026-10-05 + 70 days ends 2026-12-13, not the 14th.
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

function dayCount(start: unknown, end: unknown): number | null {
  const a = Date.parse(`${String(start)}T00:00:00Z`);
  const b = Date.parse(`${String(end)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.round((b - a) / DAY_MS) + 1;
}

function endFromLength(start: unknown, days: number): string | null {
  const a = Date.parse(`${String(start)}T00:00:00Z`);
  if (Number.isNaN(a) || !Number.isFinite(days) || days < 1) return null;
  return new Date(a + (days - 1) * DAY_MS).toISOString().slice(0, 10);
}

function TermLength({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) {
  const days = dayCount(draft.start_date, draft.end_date);
  const weeks = days === null ? null : (days / 7).toFixed(1);

  return (
    <div className="addon">
      <label className="field field-inline" htmlFor="term-length">
        <span className="field-label">Length</span>
        <input
          id="term-length"
          type="number"
          min={1}
          className="narrow"
          value={days ?? ''}
          onChange={(e) => {
            const next = endFromLength(draft.start_date, Number(e.target.value));
            if (next) onChange({ ...draft, end_date: next });
          }}
        />
        <span>days</span>
      </label>
      <p className="muted">
        {days === null
          ? 'Set a start date, then a length -- the end date follows.'
          : `${String(draft.start_date)} → ${String(draft.end_date)} · ${weeks} weeks, inclusive`}
      </p>
    </div>
  );
}

export function Admin() {
  const [table, setTable] = useState<TableName>('terms');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [refRows, setRefRows] = useState<RefRows>({});
  const [draft, setDraft] = useState<Draft>(() => emptyDraft('terms'));
  const [editing, setEditing] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Row count per table. Drives which steps are reachable: a table whose
  // required references have no rows yet cannot take a record.
  const [counts, setCounts] = useState<Partial<Record<TableName, number>>>({});

  const showSpinner = useDelayed(rows === null);

  /** Lookup tables this one points at, so the pickers have options. */
  const refTables = useMemo(
    () => [...new Set(FIELDS[table].map((f) => f.ref).filter(Boolean) as TableName[])],
    [table],
  );

  const load = useCallback(async () => {
    setError(null);
    const [main, ...refs] = await Promise.all([
      select(table, { order: 'id.desc', limit: 200 }),
      ...refTables.map((t) => select(t, { order: `${DISPLAY_COLUMN[t]}.asc`, limit: 500 })),
    ]);
    setRows(asRows(main));

    const next: RefRows = {};
    refTables.forEach((t, i) => {
      next[t] = asRows(refs[i]).map((r) => ({
        id: r.id,
        label: String(r[DISPLAY_COLUMN[t]] ?? `#${r.id}`),
      }));
    });
    setRefRows(next);
    setCounts(await fetchCounts());
  }, [table, refTables]);

  useEffect(() => {
    setRows(null);
    setFormOpen(false);
    setEditing(null);
    setDraft(emptyDraft(table));
    load().catch((err: unknown) => setError(describeError(err)));
  }, [table, load]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const payload = toPayload(table, draft);
      if (editing === null) await insert(table, payload as never);
      else await update(table, editing, payload as never);
      setFormOpen(false);
      setEditing(null);
      setDraft(emptyDraft(table));
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function destroy(id: number) {
    // Deletions cascade or are blocked by the schema's ON DELETE rules, and a
    // blocked one comes back as a readable constraint error -- so the confirm
    // is about intent, not about predicting the outcome.
    if (!window.confirm(`Delete ${TABLE_LABELS[table].one} #${id}? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await remove(table, id);
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  // A handful of columns is enough to recognise a row; the form shows the rest.
  const columns = useMemo(
    () => FIELDS[table].filter((f) => f.type !== 'textarea').slice(0, 5),
    [table],
  );

  /** Prerequisite tables that are still empty. */
  const missingFor = useCallback(
    (t: TableName) => PREREQUISITES[t].filter((dep) => (counts[dep] ?? 0) === 0),
    [counts],
  );

  const labels = TABLE_LABELS[table];

  return (
    <div className="admin">
      <nav className="admin-nav">
        {SECTIONS.map((section) => (
          <div key={section.heading}>
            <h3>{section.heading}</h3>
            {section.tables.map((t) => {
              const missing = missingFor(t);
              const blocked = missing.length > 0;
              return (
                <button
                  key={t}
                  type="button"
                  className={t === table ? 'active' : undefined}
                  disabled={blocked}
                  title={
                    blocked
                      ? `Add ${missing.map((d) => TABLE_LABELS[d].many.toLowerCase()).join(' and ')} first`
                      : undefined
                  }
                  onClick={() => setTable(t)}
                >
                  <span>{TABLE_LABELS[t].many}</span>
                  <span className="navcount">{blocked ? '—' : counts[t] ?? ''}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <section className="admin-main">
        <header className="sheet-head">
          <div>
            <h2>{labels.many}</h2>
            <p className="muted">
              {rows === null ? '…' : `${rows.length} record${rows.length === 1 ? '' : 's'}`}
            </p>
          </div>
          {!formOpen && missingFor(table).length === 0 && (
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setDraft(emptyDraft(table));
                setFormOpen(true);
              }}
            >
              New {labels.one}
            </button>
          )}
        </header>

        {/* Reachable by deep link or by a prerequisite being emptied while
            you are here, so the state is handled rather than assumed away. */}
        {missingFor(table).length > 0 && (
          <div className="notice">
            <h2>Set something up first</h2>
            <p>
              A {labels.one.toLowerCase()} must point at{' '}
              {missingFor(table)
                .map((d) => TABLE_LABELS[d].one.toLowerCase())
                .join(' and a ')}
              , and there {missingFor(table).length === 1 ? 'is none' : 'are none'} yet.
            </p>
            <div className="empty-nav">
              {missingFor(table).map((d) => (
                <button key={d} type="button" onClick={() => setTable(d)}>
                  Go to {TABLE_LABELS[d].many}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <p className="error">{error}</p>}

        {formOpen && (
          <RecordForm
            table={table}
            draft={draft}
            refRows={refRows}
            busy={busy}
            submitLabel={editing === null ? `Create ${labels.one}` : 'Save changes'}
            onChange={setDraft}
            addon={table === 'terms' ? <TermLength draft={draft} onChange={setDraft} /> : undefined}
            onSubmit={save}
            onCancel={() => {
              setFormOpen(false);
              setEditing(null);
            }}
          />
        )}

        {rows === null && showSpinner && <Loader label={`Loading ${labels.many.toLowerCase()}…`} />}

        {rows?.length === 0 && (
          <div className="empty">
            <h2>No {labels.many.toLowerCase()} yet</h2>
            <p className="muted">Use “New {labels.one}” to add the first one.</p>
          </div>
        )}

        {rows && rows.length > 0 && (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  {columns.map((c) => <th key={c.column}>{c.label}</th>)}
                  {/* Derived, not stored: terms are compared by length. */}
                  {table === 'terms' && <th>Days</th>}
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="muted">{row.id}</td>
                    {columns.map((c) => (
                      <td key={c.column}>{renderCell(row[c.column], c.ref, refRows)}</td>
                    ))}
                    {table === 'terms' && (
                      <td>{dayCount(row.start_date, row.end_date) ?? <span className="muted">—</span>}</td>
                    )}
                    <td className="rowactions">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setEditing(row.id);
                          setDraft(draftFromRow(table, row));
                          setFormOpen(true);
                        }}
                      >
                        Edit
                      </button>
                      <button type="button" disabled={busy} onClick={() => destroy(row.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** A foreign key shows the target's name, not its id. */
function renderCell(value: unknown, ref: TableName | undefined, refRows: RefRows) {
  if (value === null || value === undefined || value === '') return <span className="muted">—</span>;
  if (ref) {
    const found = refRows[ref]?.find((r) => r.id === Number(value));
    return found ? found.label : <span className="muted">#{String(value)}</span>;
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}
