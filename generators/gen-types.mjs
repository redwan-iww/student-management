// schema/model.yaml -> build/types.ts
//
// TypeScript for the React widget: an interface per entity, string-literal
// unions for every picklist, and a module/field map so widget code addresses
// Zoho by generated api_name instead of a hand-typed string.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadModel, paths, zohoApiName, storedFields, rollupFields } from './lib/model.mjs';

const model = loadModel();
const L = [];
const w = (s = '') => L.push(s);

/** households -> Household ; class_sessions -> ClassSession */
const pascal = (s) => s.split('_').map((p) => p[0].toUpperCase() + p.slice(1)).join('');
const typeName = (entity) => pascal(entity.label.replace(/\s+/g, '_'));
const enumTypeName = (key) => pascal(key);

function tsType(field) {
  switch (field.type) {
    case 'text': case 'textarea': case 'email': case 'phone': case 'url':
    case 'image': case 'autonumber': case 'date': case 'datetime': case 'time':
    case 'user_reference':
      return 'string';
    case 'integer': case 'decimal': case 'currency': case 'percent':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'enum':
      return enumTypeName(field.enum);
    case 'multi_enum':
      return `${enumTypeName(field.enum)}[]`;
    case 'reference':
      return 'ZohoRef';
    case 'rollup':
      return 'number';
    default:
      throw new Error(`unmapped type for TS: ${field.type}`);
  }
}

w('// GENERATED FILE -- do not edit.');
w('// Source: schema/model.yaml + schema/enums.yaml   (npm run gen:types)');
w('');
w('/** A Zoho lookup value as returned by the API. */');
w('export interface ZohoRef {');
w('  id: string;');
w('  name?: string;');
w('}');
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
w('// Records');
w('// ---------------------------------------------------------------------------');
w('');
for (const entity of model.entities) {
  const name = typeName(entity);
  if (entity.description) {
    w('/**');
    w(` * ${entity.description.trim().replace(/\s+/g, ' ')}`);
    w(` * Zoho module: ${entity.zoho.module}`);
    w(' */');
  }
  w(`export interface ${name} {`);
  w('  id: string;');
  for (const f of storedFields(entity)) {
    const opt = f.required ? '' : '?';
    w(`  ${f.name}${opt}: ${tsType(f)};`);
  }
  for (const f of rollupFields(entity)) {
    w(`  readonly ${f.name}?: ${tsType(f)};`);
  }
  w('}');
  w('');
}
w('// ---------------------------------------------------------------------------');
w('// Zoho field map');
w('//');
w('// Widget code should never hard-code an api_name. Go through this map so a');
w('// rename in schema/model.yaml propagates on the next `npm run gen`.');
w('//');
w('//   const { module, fields } = ZOHO_MODULES.attendance;');
w('//   ZOHO.CRM.API.insertRecord({ Entity: module, APIData: {');
w('//     [fields.status]: "Present",');
w('//     [fields.class_session]: { id: sessionId },');
w('//   }});');
w('// ---------------------------------------------------------------------------');
w('');
w('export interface ZohoModuleMap {');
w('  readonly module: string;');
w('  readonly displayField: string;');
w('  readonly fields: Readonly<Record<string, string>>;');
w('}');
w('');
w('export const ZOHO_MODULES = {');
for (const entity of model.entities) {
  w(`  ${entity.name}: {`);
  w(`    module: '${entity.zoho.module}',`);
  w(`    displayField: '${entity.zoho.display_field}',`);
  w('    fields: {');
  for (const f of entity.fields) {
    w(`      ${f.name}: '${zohoApiName(f)}',`);
  }
  w('    },');
  w('  },');
}
w('} as const satisfies Record<string, ZohoModuleMap>;');
w('');
w('export type EntityName = keyof typeof ZOHO_MODULES;');
w('');
w('/** Maps an entity name to its record interface. */');
w('export interface EntityTypes {');
for (const entity of model.entities) {
  w(`  ${entity.name}: ${typeName(entity)};`);
}
w('}');
w('');

mkdirSync(paths.build, { recursive: true });
const target = join(paths.build, 'types.ts');
writeFileSync(target, L.join('\n'), 'utf8');
console.log(`wrote ${target} (${L.length} lines)`);
