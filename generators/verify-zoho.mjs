// Drift check: compare a live Zoho `getFields` response against schema/model.yaml.
//
//   1. call getFields(module) and save the JSON to a file
//   2. node generators/verify-zoho.mjs <entity> <path-to-getFields.json>
//
// Reports, per field: missing in Zoho, type mismatch, and flag mismatches
// (mandatory / unique). Extra Zoho fields are listed but not treated as errors,
// since stock system fields always outnumber the spec.

import { readFileSync } from 'node:fs';
import { loadModel, zohoApiName, storedFields } from './lib/model.mjs';

const [entityName, file] = process.argv.slice(2);
if (!entityName || !file) {
  console.error('usage: node generators/verify-zoho.mjs <entity> <getFields.json>');
  process.exit(2);
}

const model = loadModel();
const entity = model.entityByName.get(entityName);
if (!entity) { console.error(`unknown entity: ${entityName}`); process.exit(2); }

const live = JSON.parse(readFileSync(file, 'utf8')).data.fields;
const liveByApi = new Map(live.map((f) => [f.api_name, f]));

// canonical type -> the Zoho data_type we expect back
const EXPECTED = {
  text: 'text', textarea: 'textarea', email: 'email', phone: 'phone', url: 'website',
  image: 'profileimage', integer: 'integer', decimal: 'double', currency: 'currency',
  percent: 'percent', boolean: 'boolean', date: 'date', datetime: 'datetime',
  time: 'text', enum: 'picklist', multi_enum: 'multiselectpicklist',
  reference: 'lookup', user_reference: 'userlookup', autonumber: 'autonumber',
};

const problems = [];
const info = [];
const matched = new Set();

for (const field of storedFields(entity)) {
  const api = zohoApiName(field);
  const got = liveByApi.get(api);
  if (!got) { problems.push(`MISSING   ${api}  (spec: ${field.type})`); continue; }
  matched.add(api);

  const want = EXPECTED[field.type];
  if (want && got.data_type !== want) {
    problems.push(`TYPE      ${api}  spec=${want}  zoho=${got.data_type}`);
  }
  // Mandatory-ness is NOT field metadata in Zoho -- it is per-LAYOUT config, and
  // getFields explicitly does not report it reliably ("does not contain
  // layout-specific configurations such as mandatory flags"). Asserting it here
  // produced false drift. Reported as INFO; verify for real via getLayouts.
  if (field.required && !got.system_mandatory) {
    info.push(`mandatory? ${api}  spec=required, not confirmed by getFields (check the layout)`);
  }
  const liveUnique = got.unique && Object.keys(got.unique).length > 0;
  if (field.unique && !liveUnique && field.type !== 'autonumber') {
    problems.push(`UNIQUE    ${api}  spec=unique  zoho=not unique`);
  }
  if (field.type === 'enum') {
    const specVals = model.enums[field.enum].values;
    const liveVals = (got.pick_list_values ?? []).map((v) => v.actual_value);
    const missing = specVals.filter((v) => !liveVals.includes(v));
    if (missing.length) problems.push(`PICKLIST  ${api}  missing values: ${missing.join(', ')}`);
  }
  if (field.type === 'reference') {
    const target = model.entityByName.get(field.ref).zoho.module;
    if (got.lookup?.module?.api_name !== target) {
      problems.push(`LOOKUP    ${api}  spec=${target}  zoho=${got.lookup?.module?.api_name}`);
    }
  }
}

const extra = live.filter((f) => !matched.has(f.api_name)).map((f) => f.api_name);

console.log(`entity ${entityName} -> Zoho module ${entity.zoho.module}`);
console.log(`  spec fields checked : ${storedFields(entity).length}`);
console.log(`  live fields present : ${live.length}`);
console.log(`  stock/extra in Zoho : ${extra.length}${extra.length <= 20 ? `  (${extra.join(', ')})` : ' (not listed)'}`);
console.log('');
if (info.length) {
  console.log(`INFO (${info.length}) -- layout-scoped, not checkable here:`);
  for (const i of info) console.log('  ' + i);
  console.log('');
}
if (problems.length) {
  console.log(`DRIFT (${problems.length}):`);
  for (const p of problems) console.log('  ' + p);
  process.exit(1);
}
console.log('no drift.');
