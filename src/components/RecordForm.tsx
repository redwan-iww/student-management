// A form built from the generated field metadata.
//
// Nothing here knows what a term or a course is: it renders whatever FIELDS
// says the table has. Add a column to schema/model.yaml, regenerate, and the
// field appears -- no component change.
//
// Reference fields become a picker over the target table, which is why the
// caller passes in the rows to choose from rather than this fetching them: one
// page load fetches each lookup table once, not once per form.

import type React from 'react';
import { useState } from 'react';
import { ButtonBusy } from './Loader';
import {
  FIELDS,
  type FieldMeta,
  type TableName,
} from '../generated/db-types';

export type RefRows = Partial<Record<TableName, Array<{ id: number; label: string }>>>;
export type Draft = Record<string, unknown>;

/** Blank draft for a table: every field present, so inputs stay controlled. */
export function emptyDraft(table: TableName): Draft {
  const draft: Draft = {};
  for (const f of FIELDS[table]) {
    if (f.type === 'autonumber') continue;
    draft[f.column] = f.type === 'boolean' ? false : f.type === 'multi_enum' ? [] : '';
  }
  return draft;
}

/**
 * Strips a draft down to what the API should receive.
 *
 * Empty strings become null rather than being sent as '' -- a blank optional
 * date column must be NULL, not the empty string, or the CHECK constraints
 * that compare dates see a value that is neither null nor a date.
 */
export function toPayload(table: TableName, draft: Draft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of FIELDS[table]) {
    if (f.type === 'autonumber') continue;
    const value = draft[f.column];

    if (f.type === 'boolean') {
      out[f.column] = Boolean(value);
      continue;
    }
    if (f.type === 'multi_enum') {
      const list = Array.isArray(value) ? value : [];
      out[f.column] = list.length ? list : null;
      continue;
    }
    if (value === '' || value === undefined || value === null) {
      if (f.required) continue; // let the server reject it, with its own message
      out[f.column] = null;
      continue;
    }
    if (f.type === 'number' || f.type === 'reference') {
      out[f.column] = Number(value);
      continue;
    }
    out[f.column] = value;
  }
  return out;
}

function Field({
  meta,
  value,
  refRows,
  onChange,
}: {
  meta: FieldMeta;
  value: unknown;
  refRows: RefRows;
  onChange: (v: unknown) => void;
}) {
  const id = `f-${meta.column}`;

  if (meta.type === 'boolean') {
    return (
      <label className="field field-inline" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{meta.label}</span>
      </label>
    );
  }

  const label = (
    <span className="field-label">
      {meta.label}
      {meta.required && <em aria-hidden="true"> *</em>}
    </span>
  );

  if (meta.type === 'enum') {
    return (
      <label className="field" htmlFor={id}>
        {label}
        <select id={id} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {meta.options?.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
        {meta.note && <small className="muted">{meta.note}</small>}
      </label>
    );
  }

  if (meta.type === 'multi_enum') {
    const list = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="field">
        {label}
        <div className="choices">
          {meta.options?.map((o) => (
            <label key={o}>
              <input
                type="checkbox"
                checked={list.includes(o)}
                onChange={(e) =>
                  onChange(e.target.checked ? [...list, o] : list.filter((x) => x !== o))
                }
              />
              {o}
            </label>
          ))}
        </div>
      </div>
    );
  }

  if (meta.type === 'reference') {
    const rows = (meta.ref && refRows[meta.ref]) ?? [];
    return (
      <label className="field" htmlFor={id}>
        {label}
        <select id={id} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {rows.map((r) => (
            <option key={r.id} value={r.id}>{r.label}</option>
          ))}
        </select>
        {rows.length === 0 && (
          <small className="muted">Nothing to choose yet — create a {meta.ref} first.</small>
        )}
      </label>
    );
  }

  if (meta.type === 'textarea') {
    return (
      <label className="field field-wide" htmlFor={id}>
        {label}
        <textarea id={id} rows={3} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
      </label>
    );
  }

  const inputType =
    meta.type === 'number' ? 'number'
    : meta.type === 'date' ? 'date'
    : meta.type === 'datetime' ? 'datetime-local'
    : meta.type === 'time' ? 'time'
    : meta.type === 'email' ? 'email'
    : 'text';

  return (
    <label className="field" htmlFor={id}>
      {label}
      <input
        id={id}
        type={inputType}
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
      />
      {meta.note && <small className="muted">{meta.note}</small>}
    </label>
  );
}

export function RecordForm({
  table,
  draft,
  refRows,
  busy,
  submitLabel,
  addon,
  onChange,
  onSubmit,
  onCancel,
}: {
  table: TableName;
  draft: Draft;
  refRows: RefRows;
  busy: boolean;
  submitLabel: string;
  /** Table-specific extras, rendered under the generated grid. */
  addon?: React.ReactNode;
  onChange: (next: Draft) => void;
  onSubmit: () => void;
  onCancel?: () => void;
}) {
  // Auto-numbers are assigned by the database, so there is nothing to type.
  const fields = FIELDS[table].filter((f) => f.type !== 'autonumber');

  return (
    <form
      className="recform"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="recform-grid">
        {fields.map((meta) => (
          <Field
            key={meta.column}
            meta={meta}
            value={draft[meta.column]}
            refRows={refRows}
            onChange={(v) => onChange({ ...draft, [meta.column]: v })}
          />
        ))}
      </div>
      {addon}
      <div className="recform-actions">
        <button type="submit" disabled={busy}>
          {busy ? <ButtonBusy label="Saving…" /> : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

/** Hook-free helper so the page can seed a draft from an existing row. */
export function draftFromRow(table: TableName, row: Record<string, unknown>): Draft {
  const draft = emptyDraft(table);
  for (const key of Object.keys(draft)) {
    const value = row[key];
    if (value === null || value === undefined) continue;
    draft[key] = value;
  }
  return draft;
}

export { useState };
