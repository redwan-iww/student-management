// schema/model.yaml -> build/sqlite.sql
//
// The SQLite counterpart of gen-sql.mjs. Same model, same tables, same
// constraints -- but SQLite has no enum types, no sequences and no
// ALTER TABLE ADD CONSTRAINT, so four things are expressed differently:
//
//   enums        -> TEXT + CHECK (col IN (...))
//   multi_enum   -> TEXT holding a JSON array
//   sequences    -> a `_counters` table plus one AFTER INSERT trigger per
//                   auto-number column
//   foreign keys -> inline REFERENCES, so tables are emitted in dependency
//                   order (buildOrder) rather than model order
//
// Postgres-only features that Supabase keeps and SQLite cannot have are noted
// inline, so the two files stay comparable when reading them side by side.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadModel,
  paths,
  sqlColumn,
  storedFields,
  rollupFields,
  buildOrder,
} from './lib/model.mjs';

const q = (id) => `"${id}"`;
const esc = (s) => String(s).replace(/'/g, "''");
const out = [];
const w = (line = '') => out.push(line);

const model = loadModel();
const table = (entity) => entity.sql?.table ?? entity.name;

// ---------------------------------------------------------------------------
// Column types
//
// SQLite has five storage classes and applies type affinity, so the names below
// are chosen for affinity plus readability rather than for strict checking.
// Dates and timestamps are TEXT in ISO-8601, which sorts correctly as text and
// is what Postgres/Supabase will accept verbatim on migration.
// ---------------------------------------------------------------------------
function columnType(field) {
  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'email':
    case 'phone':
    case 'url':
    case 'image':
    case 'autonumber':
    case 'user_reference':
    case 'enum':
    case 'multi_enum':
    case 'date':
    case 'datetime':
    case 'time':
      return 'TEXT';
    case 'integer':
    case 'boolean': // 0/1 -- SQLite has no boolean
    case 'reference':
      return 'INTEGER';
    case 'decimal':
    case 'currency':
    case 'percent':
      return 'NUMERIC';
    default:
      throw new Error(`unmapped type: ${field.type}`);
  }
}

function literalDefault(field) {
  if (field.default === undefined) return null;
  if (field.type === 'boolean') return field.default ? '1' : '0';
  if (['integer', 'decimal', 'currency', 'percent'].includes(field.type)) {
    return String(field.default);
  }
  return `'${esc(field.default)}'`;
}

/** "STU-{00000}" -> { prefix: 'STU-', width: 5, suffix: '' } */
function parseAutoNumber(format) {
  const m = /^(.*)\{(0+)\}(.*)$/.exec(format ?? '');
  if (!m) throw new Error(`bad autonumber format: ${format}`);
  return { prefix: m[1], width: m[2].length, suffix: m[3] };
}

const ON_DELETE = { restrict: 'RESTRICT', cascade: 'CASCADE', set_null: 'SET NULL' };

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------
w('-- GENERATED FILE -- do not edit.');
w('-- Source: schema/model.yaml + schema/enums.yaml   (npm run gen:sqlite)');
w('--');
w('-- SQLite dialect. See build/postgres.sql for the Supabase/Postgres form.');
w('');
w('-- Off by default in SQLite, and every ON DELETE rule below depends on it.');
w('PRAGMA foreign_keys = ON;');
w('');
w('BEGIN;');
w('');

// ---------------------------------------------------------------------------
// Auto-number counters
// ---------------------------------------------------------------------------
const autoNumberCols = [];
for (const entity of model.entities) {
  for (const field of storedFields(entity)) {
    if (field.type === 'autonumber') {
      autoNumberCols.push({ entity, field });
    }
  }
}

if (autoNumberCols.length) {
  w('-- ---------------------------------------------------------------------------');
  w('-- Auto-number counters (SQLite has no sequences)');
  w('-- ---------------------------------------------------------------------------');
  w('');
  w(`CREATE TABLE ${q('_counters')} (`);
  w(`  ${q('name')} TEXT PRIMARY KEY,`);
  w(`  ${q('value')} INTEGER NOT NULL DEFAULT 0`);
  w(');');
  w('');
  for (const { entity, field } of autoNumberCols) {
    const seq = `${table(entity)}_${sqlColumn(field)}`;
    w(`INSERT INTO ${q('_counters')} (${q('name')}, ${q('value')}) VALUES ('${esc(seq)}', 0);`);
  }
  w('');
}

// ---------------------------------------------------------------------------
// Tables -- dependency order, because SQLite needs inline REFERENCES
// ---------------------------------------------------------------------------
w('-- ---------------------------------------------------------------------------');
w('-- Tables');
w('-- ---------------------------------------------------------------------------');

for (const entity of buildOrder(model)) {
  const t = table(entity);
  w('');
  if (entity.description) {
    w(`-- ${entity.description.trim().replace(/\s+/g, ' ')}`);
  }
  w(`CREATE TABLE ${q(t)} (`);

  // INTEGER PRIMARY KEY is the rowid alias, so this is SQLite's bigserial.
  const lines = [`  ${q('id')} INTEGER PRIMARY KEY AUTOINCREMENT`];

  for (const field of storedFields(entity)) {
    const col = sqlColumn(field);
    let line = `  ${q(col)} ${columnType(field)}`;

    // An auto-number is filled by a trigger after insert, so it cannot be
    // NOT NULL at insert time the way the Postgres DEFAULT allows.
    if (field.type !== 'autonumber' && field.required) line += ' NOT NULL';

    const def = literalDefault(field);
    if (def !== null) line += ` DEFAULT ${def}`;
    if (field.unique) line += ' UNIQUE';

    // Enums: no native type, so the values are enforced by a CHECK. NULL is
    // permitted unless the field is required, matching Postgres.
    if (field.type === 'enum') {
      const values = model.enums[field.enum].values.map((v) => `'${esc(v)}'`).join(', ');
      line += ` CHECK (${q(col)} IS NULL OR ${q(col)} IN (${values}))`;
    }
    // multi_enum is a JSON array of those values; validating each element needs
    // json_each, which a column CHECK cannot do. Shape is checked instead.
    if (field.type === 'multi_enum') {
      line += ` CHECK (${q(col)} IS NULL OR json_valid(${q(col)}))`;
    }

    if (field.type === 'reference') {
      const target = table(model.entityByName.get(field.ref));
      line +=
        ` REFERENCES ${q(target)} (${q('id')})` +
        ` ON DELETE ${ON_DELETE[field.on_delete ?? 'restrict']}`;
    }

    lines.push(line);
    if (field.note) {
      lines.push(`  -- ${col}: ${field.note.trim().replace(/\s+/g, ' ')}`);
    }
  }

  lines.push(`  ${q('created_at')} TEXT NOT NULL DEFAULT (datetime('now'))`);
  lines.push(`  ${q('updated_at')} TEXT NOT NULL DEFAULT (datetime('now'))`);

  for (const c of entity.constraints ?? []) {
    if (c.type === 'check') {
      lines.push(`  CONSTRAINT ${q(c.name)} CHECK (${c.expr})`);
    } else if (c.type === 'unique') {
      const cols = c.fields.map((fname) => {
        const f = entity.fields.find((x) => x.name === fname);
        return q(sqlColumn(f));
      });
      lines.push(`  CONSTRAINT ${q(c.name)} UNIQUE (${cols.join(', ')})`);
    }
  }

  // Comment lines must not carry the separating comma.
  const body = lines
    .map((line, i) => {
      const isComment = line.trimStart().startsWith('--');
      const next = lines[i + 1];
      const lastReal = !lines.slice(i + 1).some((l) => !l.trimStart().startsWith('--'));
      return isComment || lastReal ? line : `${line},`;
    })
    .join('\n')
    .replace(/,(\s*--[^\n]*\n)/g, '$1,');
  w(body);
  w(');');
}
w('');

// ---------------------------------------------------------------------------
// Auto-number triggers
// ---------------------------------------------------------------------------
if (autoNumberCols.length) {
  w('-- ---------------------------------------------------------------------------');
  w('-- Auto-number triggers: bump the counter, then format the value');
  w('-- ---------------------------------------------------------------------------');

  for (const { entity, field } of autoNumberCols) {
    const t = table(entity);
    const col = sqlColumn(field);
    const seq = `${t}_${col}`;
    const { prefix, width, suffix } = parseAutoNumber(field.format);
    w('');
    w(`CREATE TRIGGER ${q(`trg_${seq}`)} AFTER INSERT ON ${q(t)}`);
    w(`FOR EACH ROW WHEN NEW.${q(col)} IS NULL`);
    w('BEGIN');
    w(`  UPDATE ${q('_counters')} SET ${q('value')} = ${q('value')} + 1 WHERE ${q('name')} = '${esc(seq)}';`);
    w(`  UPDATE ${q(t)} SET ${q(col)} =`);
    w(
      `    '${esc(prefix)}' || substr('${'0'.repeat(width)}' || ` +
        `(SELECT ${q('value')} FROM ${q('_counters')} WHERE ${q('name')} = '${esc(seq)}'), -${width})` +
        (suffix ? ` || '${esc(suffix)}'` : ''),
    );
    w(`  WHERE ${q('id')} = NEW.${q('id')};`);
    w('END;');
  }
  w('');
}

// ---------------------------------------------------------------------------
// updated_at
// ---------------------------------------------------------------------------
w('-- ---------------------------------------------------------------------------');
w('-- updated_at maintenance');
w('-- ---------------------------------------------------------------------------');

for (const entity of model.entities) {
  const t = table(entity);
  w('');
  w(`CREATE TRIGGER ${q(`trg_${t}_updated_at`)} AFTER UPDATE ON ${q(t)}`);
  w(`FOR EACH ROW WHEN NEW.${q('updated_at')} = OLD.${q('updated_at')}`);
  w('BEGIN');
  w(`  UPDATE ${q(t)} SET ${q('updated_at')} = datetime('now') WHERE ${q('id')} = NEW.${q('id')};`);
  w('END;');
}
w('');

// ---------------------------------------------------------------------------
// Derived (denormalized) columns
// ---------------------------------------------------------------------------
const derivedEntities = model.entities.filter((e) => e.fields.some((f) => f.derived_from));
if (derivedEntities.length) {
  w('-- ---------------------------------------------------------------------------');
  w('-- Derived columns, kept in step with their source row');
  w('-- ---------------------------------------------------------------------------');

  for (const entity of derivedEntities) {
    const t = table(entity);
    const derived = entity.fields.filter((f) => f.derived_from);

    // SQLite has no BEFORE-trigger row mutation, so this runs AFTER and writes
    // back -- guarded by WHEN so it cannot recurse.
    for (const evt of ['INSERT', 'UPDATE']) {
      w('');
      w(`CREATE TRIGGER ${q(`trg_${t}_derived_${evt.toLowerCase()}`)} AFTER ${evt} ON ${q(t)}`);
      w('FOR EACH ROW');
      w('BEGIN');
      w(`  UPDATE ${q(t)} SET`);
      const sets = derived.map((field) => {
        const [localName, remoteName] = field.derived_from.split('.');
        const localField = entity.fields.find((f) => f.name === localName);
        const remoteEntity = model.entityByName.get(localField.ref);
        const remoteField = remoteEntity.fields.find((f) => f.name === remoteName);
        return (
          `    ${q(sqlColumn(field))} = (SELECT ${q(sqlColumn(remoteField))} ` +
          `FROM ${q(table(remoteEntity))} WHERE ${q('id')} = NEW.${q(sqlColumn(localField))})`
        );
      });
      w(sets.join(',\n'));
      w(`  WHERE ${q('id')} = NEW.${q('id')};`);
      w('END;');
    }
  }
  w('');
}

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------
w('-- ---------------------------------------------------------------------------');
w('-- Indexes');
w('-- ---------------------------------------------------------------------------');
w('');

for (const entity of model.entities) {
  const t = table(entity);
  for (const field of storedFields(entity)) {
    if (field.type !== 'reference') continue;
    const col = sqlColumn(field);
    w(`CREATE INDEX ${q(`idx_${t}_${col}`)} ON ${q(t)} (${q(col)});`);
  }
}
for (const idx of model.indexes ?? []) {
  const entity = model.entityByName.get(idx.entity);
  const t = table(entity);
  const cols = idx.fields.map((fname) => {
    const f = entity.fields.find((x) => x.name === fname);
    return q(sqlColumn(f));
  });
  w(`CREATE INDEX ${q(idx.name)} ON ${q(t)} (${cols.join(', ')});`);
}
w('');

// ---------------------------------------------------------------------------
// Rollup views
// ---------------------------------------------------------------------------
w('-- ---------------------------------------------------------------------------');
w('-- Rollup views. `v_<table>` = the base table plus its derived counters.');
w('-- ---------------------------------------------------------------------------');

for (const entity of model.entities) {
  const rollups = rollupFields(entity);
  if (!rollups.length) continue;
  const t = table(entity);

  const selects = rollups.map((field) => {
    const r = field.rollup;
    const src = model.entityByName.get(r.from);
    const srcTable = table(src);
    const viaField = src.fields.find((f) => f.name === r.via);
    const link = `${q(srcTable)}.${q(sqlColumn(viaField))} = ${q(t)}.${q('id')}`;

    if (r.function === 'count') {
      const filter = r.where ? ` AND (${r.where})` : '';
      return `  (SELECT count(*) FROM ${q(srcTable)} WHERE ${link}${filter}) AS ${q(field.name)}`;
    }
    if (r.function === 'percent') {
      // No FILTER clause in SQLite; CASE inside the aggregate is the equivalent.
      return (
        `  (SELECT round(100.0 * sum(CASE WHEN ${r.where} THEN 1 ELSE 0 END)\n` +
        `                / NULLIF(sum(CASE WHEN ${r.of} THEN 1 ELSE 0 END), 0), 2)\n` +
        `     FROM ${q(srcTable)} WHERE ${link}) AS ${q(field.name)}`
      );
    }
    throw new Error(`unmapped rollup function: ${r.function}`);
  });

  w('');
  w(`CREATE VIEW ${q(`v_${t}`)} AS`);
  w(`SELECT ${q(t)}.*,`);
  w(selects.join(',\n'));
  w(`FROM ${q(t)};`);
}

w('');
w('COMMIT;');
w('');

const target = join(paths.build, 'sqlite.sql');
mkdirSync(paths.build, { recursive: true });
writeFileSync(target, out.join('\n'), 'utf8');
console.log(`wrote ${target}  (${out.length} lines)`);
