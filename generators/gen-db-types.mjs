// schema/model.yaml -> build/db-types.ts
//
// TypeScript for the SQL-backed app: string-literal unions for every picklist,
// a row interface per table, and a TABLES map of snake_case column names.
//
// The SQL counterpart of gen-types.mjs. The difference is the shape of a
// record: this one has flat snake_case columns and numeric foreign keys
// (`term_id: number`), where the Zoho one has PascalCase api_names and
// `{ id, name }` lookup objects.
//
// Rollup fields appear on the row type because reads go through `v_<table>`,
// which carries them. They are never written.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadModel, paths, sqlColumn, storedFields, rollupFields } from './lib/model.mjs';

const model = loadModel();
const L = [];
const w = (s = '') => L.push(s);

const pascal = (s) => s.split('_').map((p) => p[0].toUpperCase() + p.slice(1)).join('');
const typeName = (entity) => pascal(entity.label.replace(/\s+/g, '_'));
const enumTypeName = (key) => pascal(key);
const table = (entity) => entity.sql?.table ?? entity.name;

function tsType(field) {
  switch (field.type) {
    case 'text': case 'textarea': case 'email': case 'phone': case 'url':
    case 'image': case 'autonumber': case 'date': case 'datetime': case 'time':
    case 'user_reference':
      return 'string';
    case 'integer': case 'decimal': case 'currency': case 'percent': case 'rollup':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'enum':
      return enumTypeName(field.enum);
    case 'multi_enum':
      return `${enumTypeName(field.enum)}[]`;
    // A foreign key is the integer id. Joins are done by the caller.
    case 'reference':
      return 'number';
    default:
      throw new Error(`unmapped type for TS: ${field.type}`);
  }
}

w('// GENERATED FILE -- do not edit.');
w('// Source: schema/model.yaml + schema/enums.yaml   (npm run gen:db-types)');
w('//');
w('// Rows are flat and snake_case, matching the SQL columns. A reference is the');
w('// integer id of the target row.');
w('');

w('// ---------------------------------------------------------------------------');
w('// Picklists');
w('// ---------------------------------------------------------------------------');
w('');
for (const [key, def] of Object.entries(model.enums)) {
  w(`export type ${enumTypeName(key)} =`);
  w(def.values.map((v) => `  | '${v}'`).join('\n') + ';');
  w('');
  w(`export const ${key.toUpperCase()}_VALUES: readonly ${enumTypeName(key)}[] = [`);
  w(def.values.map((v) => `  '${v}',`).join('\n'));
  w('] as const;');
  w('');
}

w('// ---------------------------------------------------------------------------');
w('// Rows');
w('// ---------------------------------------------------------------------------');
w('');
w('/** Columns every table carries. */');
w('export interface BaseRow {');
w('  id: number;');
w('  created_at: string;');
w('  updated_at: string;');
w('}');
w('');

for (const entity of model.entities) {
  const name = typeName(entity);
  if (entity.description) {
    w(`/** ${entity.description.trim().replace(/\s+/g, ' ')} */`);
  }
  w(`export interface ${name} extends BaseRow {`);
  for (const field of storedFields(entity)) {
    const col = sqlColumn(field);
    const optional = field.required && field.type !== 'autonumber' ? '' : '?';
    const nullable = field.required ? '' : ' | null';
    w(`  ${col}${optional}: ${tsType(field)}${nullable};`);
  }
  const rollups = rollupFields(entity);
  if (rollups.length) {
    w('  // Rollups: present when read through v_<table>, never written.');
    for (const field of rollups) w(`  ${field.name}?: number;`);
  }
  w('}');
  w('');
}

w('// ---------------------------------------------------------------------------');
w('// Table + column names');
w('// ---------------------------------------------------------------------------');
w('');
w('/**');
w(' * Nothing in the app hard-codes a table or column string. Rename a field in');
w(' * schema/model.yaml, regenerate, and a stale reference becomes a compile');
w(' * error instead of a silently empty column.');
w(' */');
w('export const TABLES = {');
for (const entity of model.entities) {
  const cols = storedFields(entity).map((f) => `      ${f.name}: '${sqlColumn(f)}',`);
  const rollups = rollupFields(entity).map((f) => `      ${f.name}: '${f.name}',`);
  w(`  ${entity.name}: {`);
  w(`    table: '${table(entity)}',`);
  w('    columns: {');
  w('      id: \'id\',');
  w(cols.join('\n'));
  if (rollups.length) w(rollups.join('\n'));
  w('    },');
  w('  },');
}
w('} as const;');
w('');
w('export type TableName = keyof typeof TABLES;');
w('');

w('// ---------------------------------------------------------------------------');
w('// Field metadata');
w('// ---------------------------------------------------------------------------');
w('');
w('/**');
w(' * Enough about each column to build a form for it without hand-writing one.');
w(' *');
w(' * The admin page renders from this, so a field added to schema/model.yaml');
w(' * shows up in the UI on the next `npm run gen` with no component change.');
w(' */');
w('export interface FieldMeta {');
w('  column: string;');
w('  label: string;');
w("  type: 'text' | 'textarea' | 'number' | 'boolean' | 'date' | 'datetime' | 'time'");
w("      | 'enum' | 'multi_enum' | 'reference' | 'autonumber' | 'email' | 'phone' | 'url';");
w('  required: boolean;');
w('  /** Picklist values, for enum and multi_enum. */');
w('  options?: readonly string[];');
w('  /** Target table, for reference. */');
w('  ref?: TableName;');
w('  /** Which column of the target row to show. */');
w('  refLabel?: string;');
w('  note?: string;');
w('}');
w('');

/** The column a row is best identified by in a picker. */
function displayColumn(entity) {
  const names = ['name', 'full_name', 'household_name', 'class_code', 'term_code'];
  for (const candidate of names) {
    const f = entity.fields.find((x) => x.name === candidate);
    if (f) return sqlColumn(f);
  }
  return 'id';
}

const FORM_TYPE = {
  text: 'text', textarea: 'textarea', email: 'email', phone: 'phone', url: 'url',
  image: 'text', user_reference: 'text',
  integer: 'number', decimal: 'number', currency: 'number', percent: 'number',
  boolean: 'boolean', date: 'date', datetime: 'datetime', time: 'time',
  enum: 'enum', multi_enum: 'multi_enum', reference: 'reference',
  autonumber: 'autonumber',
};

w('export const FIELDS: Record<TableName, readonly FieldMeta[]> = {');
for (const entity of model.entities) {
  w(`  ${entity.name}: [`);
  for (const field of storedFields(entity)) {
    const bits = [
      `column: '${sqlColumn(field)}'`,
      `label: ${JSON.stringify(field.label ?? field.name)}`,
      `type: '${FORM_TYPE[field.type]}'`,
      `required: ${Boolean(field.required)}`,
    ];
    if (field.enum) {
      bits.push(`options: ${field.enum.toUpperCase()}_VALUES`);
    }
    if (field.type === 'reference') {
      const target = model.entityByName.get(field.ref);
      bits.push(`ref: '${target.name}'`);
      bits.push(`refLabel: '${displayColumn(target)}'`);
    }
    if (field.note) {
      bits.push(`note: ${JSON.stringify(field.note.trim().replace(/\s+/g, ' '))}`);
    }
    w(`    { ${bits.join(', ')} },`);
  }
  w('  ],');
}
w('};');
w('');

w('/** The column that best names a row of each table, for pickers and lists. */');
w('export const DISPLAY_COLUMN: Record<TableName, string> = {');
for (const entity of model.entities) {
  w(`  ${entity.name}: '${displayColumn(entity)}',`);
}
w('};');
w('');

w('/** Human labels, singular and plural. */');
w('export const TABLE_LABELS: Record<TableName, { one: string; many: string }> = {');
for (const entity of model.entities) {
  w(
    `  ${entity.name}: { one: ${JSON.stringify(entity.label)}, ` +
      `many: ${JSON.stringify(entity.plural_label ?? `${entity.label}s`)} },`,
  );
}
w('};');
w('');

w('/** Row type per table name, so a query can be typed by the table it reads. */');
w('export interface RowTypes {');
for (const entity of model.entities) {
  w(`  ${entity.name}: ${typeName(entity)};`);
}
w('}');
w('');

const target = join(paths.build, 'db-types.ts');
mkdirSync(paths.build, { recursive: true });
writeFileSync(target, L.join('\n'), 'utf8');
console.log(`wrote ${target}  (${L.length} lines)`);
