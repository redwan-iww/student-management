// schema/model.yaml -> build/postgres.sql
//
// Emits: enum types, tables, FKs, unique + check constraints, indexes,
// auto-number defaults, derived-field triggers, updated_at triggers, and one
// view per entity carrying its rollup columns.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadModel, paths, sqlColumn, storedFields, rollupFields } from './lib/model.mjs';

const q = (id) => `"${id}"`;
const out = [];
const w = (line = '') => out.push(line);

const model = loadModel();
const table = (entity) => entity.sql?.table ?? entity.name;

// ---------------------------------------------------------------------------
// Column types
// ---------------------------------------------------------------------------
function columnType(field) {
  switch (field.type) {
    case 'text':       return `varchar(${field.length ?? 255})`;
    case 'textarea':   return 'text';
    case 'email':      return 'varchar(160)';
    case 'phone':      return 'varchar(40)';
    case 'url':        return 'varchar(512)';
    case 'image':      return 'text';
    case 'integer':    return 'integer';
    case 'decimal':    return `numeric(${field.precision ?? 12},${field.scale ?? 2})`;
    case 'currency':   return 'numeric(14,2)';
    case 'percent':    return 'numeric(5,2)';
    case 'boolean':    return 'boolean';
    case 'date':       return 'date';
    case 'datetime':   return 'timestamptz';
    case 'time':       return 'time';
    case 'enum':       return q(field.enum);
    case 'multi_enum': return `${q(field.enum)}[]`;
    case 'reference':  return 'bigint';
    case 'user_reference': return 'varchar(64)';
    case 'autonumber': return 'varchar(40)';
    default: throw new Error(`unmapped type: ${field.type}`);
  }
}

function literalDefault(field) {
  if (field.default === undefined) return null;
  if (field.type === 'boolean') return String(field.default);
  if (['integer', 'decimal', 'currency', 'percent'].includes(field.type)) return String(field.default);
  if (field.type === 'enum') return `'${field.default}'::${q(field.enum)}`;
  return `'${String(field.default).replace(/'/g, "''")}'`;
}

/** "STU-{00000}" -> { prefix: 'STU-', width: 5 } */
function parseAutoNumber(format) {
  const m = /^(.*)\{(0+)\}(.*)$/.exec(format ?? '');
  if (!m) throw new Error(`bad autonumber format: ${format}`);
  return { prefix: m[1], width: m[2].length, suffix: m[3] };
}

const ON_DELETE = { restrict: 'RESTRICT', cascade: 'CASCADE', set_null: 'SET NULL' };

// ---------------------------------------------------------------------------
// Header + enum types
// ---------------------------------------------------------------------------
w('-- GENERATED FILE -- do not edit.');
w('-- Source: schema/model.yaml + schema/enums.yaml   (npm run gen:sql)');
w('');
w('BEGIN;');
w('');
w('-- ---------------------------------------------------------------------------');
w('-- Enum types');
w('-- ---------------------------------------------------------------------------');

const usedEnums = new Set();
for (const e of model.entities) {
  for (const f of e.fields) if (f.enum) usedEnums.add(f.enum);
}
for (const key of [...usedEnums].sort()) {
  const values = model.enums[key].values.map((v) => `'${v.replace(/'/g, "''")}'`);
  w('');
  w(`CREATE TYPE ${q(key)} AS ENUM (`);
  w(`  ${values.join(',\n  ')}`);
  w(');');
}
w('');
// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------
w('-- ---------------------------------------------------------------------------');
w('-- Tables');
w('-- ---------------------------------------------------------------------------');

const comments = [];

for (const entity of model.entities) {
  const t = table(entity);
  w('');
  w(`CREATE TABLE ${q(t)} (`);

  const lines = [`  ${q('id')} bigserial PRIMARY KEY`];

  for (const field of storedFields(entity)) {
    const col = sqlColumn(field);
    let line = `  ${q(col)} ${columnType(field)}`;

    if (field.type === 'autonumber') {
      const { prefix, width, suffix } = parseAutoNumber(field.format);
      const seq = `${t}_${col}_seq`;
      comments.push({ kind: 'seq', seq });
      const tail = suffix ? ` || '${suffix}'` : '';
      line += ` NOT NULL DEFAULT ('${prefix}' || lpad(nextval('${seq}')::text, ${width}, '0')${tail})`;
    } else {
      if (field.required) line += ' NOT NULL';
      const def = literalDefault(field);
      if (def !== null) line += ` DEFAULT ${def}`;
    }
    if (field.unique) line += ' UNIQUE';
    lines.push(line);

    if (field.note) comments.push({ kind: 'col', table: t, col, text: field.note });
  }

  lines.push(`  ${q('created_at')} timestamptz NOT NULL DEFAULT now()`);
  lines.push(`  ${q('updated_at')} timestamptz NOT NULL DEFAULT now()`.replace(/^ {2}/, '  '));

  // table-level constraints
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

  w(lines.join(',\n'));
  w(');');

  if (entity.description) {
    comments.push({ kind: 'table', table: t, text: entity.description.trim().replace(/\s+/g, ' ') });
  }
}

// Sequences must exist before the DEFAULTs that call them; emit them first by
// prepending. Find the marker line and splice.
const seqLines = comments
  .filter((c) => c.kind === 'seq')
  .map((c) => `CREATE SEQUENCE ${q(c.seq)};`);
if (seqLines.length) {
  const marker = out.indexOf('-- Tables');
  out.splice(marker - 1, 0, '-- Auto-number sequences', ...seqLines, '');
}
w('');
// ---------------------------------------------------------------------------
// Foreign keys (added after all tables exist, so order in model.yaml is free)
// ---------------------------------------------------------------------------
w('-- ---------------------------------------------------------------------------');
w('-- Foreign keys');
w('-- ---------------------------------------------------------------------------');
w('');

for (const entity of model.entities) {
  const t = table(entity);
  for (const field of storedFields(entity)) {
    if (field.type !== 'reference') continue;
    const target = table(model.entityByName.get(field.ref));
    const col = sqlColumn(field);
    const name = `fk_${t}_${col}`;
    w(
      `ALTER TABLE ${q(t)} ADD CONSTRAINT ${q(name)} ` +
        `FOREIGN KEY (${q(col)}) REFERENCES ${q(target)} (${q('id')}) ` +
        `ON DELETE ${ON_DELETE[field.on_delete]};`,
    );
  }
}
w('');

// ---------------------------------------------------------------------------
// Indexes: one per reference column, plus the explicit list in model.yaml
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
w('');
for (const idx of model.indexes ?? []) {
  const entity = model.entityByName.get(idx.entity);
  const cols = idx.fields.map((fname) => q(sqlColumn(entity.fields.find((f) => f.name === fname))));
  w(`CREATE INDEX ${q(idx.name)} ON ${q(table(entity))} (${cols.join(', ')});`);
}
w('');

// ---------------------------------------------------------------------------
// updated_at
// ---------------------------------------------------------------------------
w('-- ---------------------------------------------------------------------------');
w('-- updated_at maintenance');
w('-- ---------------------------------------------------------------------------');
w('');
w(`CREATE OR REPLACE FUNCTION ${q('set_updated_at')}() RETURNS trigger AS $$`);
w('BEGIN');
w('  NEW.updated_at := now();');
w('  RETURN NEW;');
w('END;');
w('$$ LANGUAGE plpgsql;');
w('');
for (const entity of model.entities) {
  const t = table(entity);
  w(
    `CREATE TRIGGER ${q(`trg_${t}_updated_at`)} BEFORE UPDATE ON ${q(t)} ` +
      `FOR EACH ROW EXECUTE FUNCTION ${q('set_updated_at')}();`,
  );
}
w('');
// ---------------------------------------------------------------------------
// Derived (denormalized) columns -- the SQL counterpart of the Zoho workflows
// that keep enrollments.term/course and attendance.student/class in step.
// ---------------------------------------------------------------------------
const derivedEntities = model.entities.filter((e) => e.fields.some((f) => f.derived_from));
if (derivedEntities.length) {
  w('-- ---------------------------------------------------------------------------');
  w('-- Derived columns (denormalized for query parity with Zoho COQL)');
  w('-- ---------------------------------------------------------------------------');

  for (const entity of derivedEntities) {
    const t = table(entity);
    const fn = `sync_${t}_derived`;
    w('');
    w(`CREATE OR REPLACE FUNCTION ${q(fn)}() RETURNS trigger AS $$`);
    w('BEGIN');
    for (const field of entity.fields.filter((f) => f.derived_from)) {
      const [localName, remoteName] = field.derived_from.split('.');
      const localField = entity.fields.find((f) => f.name === localName);
      const remoteEntity = model.entityByName.get(localField.ref);
      const remoteField = remoteEntity.fields.find((f) => f.name === remoteName);
      w(
        `  NEW.${q(sqlColumn(field))} := (SELECT ${q(sqlColumn(remoteField))} ` +
          `FROM ${q(table(remoteEntity))} WHERE ${q('id')} = NEW.${q(sqlColumn(localField))});`,
      );
    }
    w('  RETURN NEW;');
    w('END;');
    w('$$ LANGUAGE plpgsql;');
    w('');
    w(
      `CREATE TRIGGER ${q(`trg_${t}_derived`)} BEFORE INSERT OR UPDATE ON ${q(t)} ` +
        `FOR EACH ROW EXECUTE FUNCTION ${q(fn)}();`,
    );
  }
  w('');
}

// ---------------------------------------------------------------------------
// Rollups -- views, never stored columns
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
      return `  (SELECT count(*) FROM ${q(srcTable)} WHERE ${link}${filter})::integer AS ${q(field.name)}`;
    }
    if (r.function === 'percent') {
      return (
        `  (SELECT round(100.0 * count(*) FILTER (WHERE ${r.where})\n` +
        `                / NULLIF(count(*) FILTER (WHERE ${r.of}), 0), 2)\n` +
        `     FROM ${q(srcTable)} WHERE ${link})::numeric(5,2) AS ${q(field.name)}`
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

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------
w('-- ---------------------------------------------------------------------------');
w('-- Comments');
w('-- ---------------------------------------------------------------------------');
w('');
const esc = (s) => s.replace(/'/g, "''");
for (const c of comments) {
  if (c.kind === 'table') w(`COMMENT ON TABLE ${q(c.table)} IS '${esc(c.text)}';`);
  if (c.kind === 'col') w(`COMMENT ON COLUMN ${q(c.table)}.${q(c.col)} IS '${esc(c.text)}';`);
}
w('');
w('COMMIT;');
w('');

mkdirSync(paths.build, { recursive: true });
const target = join(paths.build, 'postgres.sql');
writeFileSync(target, out.join('\n'), 'utf8');
console.log(`wrote ${target} (${out.length} lines)`);
