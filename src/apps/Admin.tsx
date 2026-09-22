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
import { insert, remove, select, update } from '../data/api';

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

export function Admin() {
  const [table, setTable] = useState<TableName>('terms');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [refRows, setRefRows] = useState<RefRows>({});
  const [draft, setDraft] = useState<Draft>(() => emptyDraft('terms'));
  const [editing, setEditing] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const labels = TABLE_LABELS[table];

  return (
    <div className="admin">
      <nav className="admin-nav">
        {SECTIONS.map((section) => (
          <div key={section.heading}>
            <h3>{section.heading}</h3>
            {section.tables.map((t) => (
              <button
                key={t}
                type="button"
                className={t === table ? 'active' : undefined}
                onClick={() => setTable(t)}
              >
                {TABLE_LABELS[t].many}
              </button>
            ))}
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
          {!formOpen && (
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

        {error && <p className="error">{error}</p>}

        {formOpen && (
          <RecordForm
            table={table}
            draft={draft}
            refRows={refRows}
            busy={busy}
            submitLabel={editing === null ? `Create ${labels.one}` : 'Save changes'}
            onChange={setDraft}
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
