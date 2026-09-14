// schema/model.yaml -> docs/erd.md, docs/data-dictionary.md, docs/zoho-mapping.md

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadModel, paths, sqlColumn, zohoApiName, storedFields, rollupFields, buildOrder } from './lib/model.mjs';

const model = loadModel();
mkdirSync(paths.docs, { recursive: true });
const table = (e) => e.sql?.table ?? e.name;
const oneLine = (s) => (s ?? '').trim().replace(/\s+/g, ' ');

// ---------------------------------------------------------------------------
// erd.md
// ---------------------------------------------------------------------------
{
  const L = [];
  L.push('# Entity Relationship Diagram');
  L.push('');
  L.push('<!-- GENERATED FILE -- do not edit. Source: schema/model.yaml (npm run gen:docs) -->');
  L.push('');
  L.push('Crow\'s feet point at the many side. `o|` marks an optional reference.');
  L.push('');
  L.push('```mermaid');
  L.push('erDiagram');

  for (const entity of model.entities) {
    L.push(`    ${entity.name.toUpperCase()} {`);
    for (const f of storedFields(entity)) {
      const type = f.type === 'reference' ? `FK_${f.ref}` : f.type;
      const flags = [f.required ? 'required' : null, f.unique ? 'unique' : null].filter(Boolean).join(',');
      L.push(`        ${type} ${f.name}${flags ? ` "${flags}"` : ''}`);
    }
    L.push('    }');
  }
  L.push('');
  for (const entity of model.entities) {
    for (const f of storedFields(entity)) {
      if (f.type !== 'reference') continue;
      const card = f.required ? '||--o{' : '|o--o{';
      L.push(`    ${f.ref.toUpperCase()} ${card} ${entity.name.toUpperCase()} : "${f.name}"`);
    }
  }
  L.push('```');
  L.push('');
  L.push('## Reading the model');
  L.push('');
  for (const entity of model.entities) {
    if (!entity.description) continue;
    L.push(`- **${entity.label}** (\`${entity.name}\`) — ${oneLine(entity.description)}`);
  }
  L.push('');
  writeFileSync(join(paths.docs, 'erd.md'), L.join('\n'), 'utf8');
}

// ---------------------------------------------------------------------------
// data-dictionary.md
// ---------------------------------------------------------------------------
{
  const L = [];
  L.push('# Data Dictionary');
  L.push('');
  L.push('<!-- GENERATED FILE -- do not edit. Source: schema/model.yaml (npm run gen:docs) -->');
  L.push('');
  L.push(`${model.entities.length} entities. Rollup fields are derived — they exist as a Zoho`);
  L.push('rollup summary and as a column on the Postgres `v_<table>` view, never as stored data.');
  L.push('');

  for (const entity of model.entities) {
    L.push(`## ${entity.label} — \`${entity.name}\``);
    L.push('');
    if (entity.description) { L.push(oneLine(entity.description)); L.push(''); }
    L.push(`SQL table \`${table(entity)}\` · Zoho module \`${entity.zoho.module}\` (${entity.zoho.strategy})`);
    L.push('');
    L.push('| Field | Type | Req | Unique | SQL column | Notes |');
    L.push('|---|---|:-:|:-:|---|---|');
    for (const f of entity.fields) {
      let type = f.type;
      if (f.enum) type += ` \`${f.enum}\``;
      if (f.ref) type += ` → \`${f.ref}\``;
      if (f.type === 'rollup') type = `rollup(${f.rollup.function} of \`${f.rollup.from}\`)`;
      const notes = [f.note ? oneLine(f.note) : null, f.derived_from ? `derived from \`${f.derived_from}\`` : null,
        f.default !== undefined ? `default \`${f.default}\`` : null].filter(Boolean).join('; ');
      const col = f.type === 'rollup' ? '_(view)_' : `\`${sqlColumn(f)}\``;
      L.push(`| \`${f.name}\` | ${type} | ${f.required ? '✓' : ''} | ${f.unique ? '✓' : ''} | ${col} | ${notes} |`);
    }
    L.push('');
    if (entity.constraints?.length) {
      L.push('**Constraints**');
      L.push('');
      for (const c of entity.constraints) {
        const body = c.type === 'unique' ? `unique (${c.fields.join(', ')})` : `check \`${c.expr}\``;
        L.push(`- \`${c.name}\` — ${body}${c.note ? ` — ${oneLine(c.note)}` : ''}`);
      }
      L.push('');
    }
  }

  L.push('## Enumerations');
  L.push('');
  for (const [key, def] of Object.entries(model.enums)) {
    L.push(`- \`${key}\` — ${def.values.map((v) => `\`${v}\``).join(', ')}`);
  }
  L.push('');
  writeFileSync(join(paths.docs, 'data-dictionary.md'), L.join('\n'), 'utf8');
}

// ---------------------------------------------------------------------------
// zoho-mapping.md
// ---------------------------------------------------------------------------
{
  const L = [];
  L.push('# Zoho CRM Mapping');
  L.push('');
  L.push('<!-- GENERATED FILE -- do not edit. Source: schema/model.yaml (npm run gen:docs) -->');
  L.push('');
  L.push('The contract between the canonical model and the CRM. `getFields` on a live');
  L.push('module must agree with the `Zoho api_name` column here — that diff is the');
  L.push('drift check.');
  L.push('');
  L.push('## Module map');
  L.push('');
  L.push('| Entity | Zoho module | Strategy | Notes |');
  L.push('|---|---|---|---|');
  for (const e of model.entities) {
    const notes = [e.zoho.note, e.zoho.collision_risk].filter(Boolean).map(oneLine).join(' ');
    L.push(`| \`${e.name}\` | \`${e.zoho.module}\` | ${e.zoho.strategy} | ${notes} |`);
  }
  L.push('');
  L.push('Strategies: `extend_standard` = stock Zoho module, add custom fields only ·');
  L.push('`extend_custom` = custom module already in the org · `create` = must be created.');
  L.push('');

  L.push('## Field map');
  L.push('');
  for (const entity of model.entities) {
    L.push(`### ${entity.zoho.module} — \`${entity.name}\``);
    L.push('');
    L.push('| Field | Zoho api_name | Zoho data_type | Stock? |');
    L.push('|---|---|---|:-:|');
    for (const f of entity.fields) {
      let dt;
      if (f.type === 'rollup') dt = 'rollup summary';
      else if (f.type === 'reference') dt = `lookup → \`${model.entityByName.get(f.ref).zoho.module}\``;
      else if (f.type === 'user_reference') dt = 'userlookup';
      else if (f.type === 'enum') dt = 'picklist';
      else if (f.type === 'multi_enum') dt = 'multiselectpicklist';
      else if (f.type === 'time') dt = 'text (HH:MM — Zoho has no time type)';
      else if (f.type === 'textarea') dt = 'textarea';
      else if (f.type === 'url') dt = 'website';
      else if (f.type === 'decimal') dt = 'double';
      else if (f.type === 'image') dt = 'profileimage';
      else dt = f.type;
      L.push(`| \`${f.name}\` | \`${zohoApiName(f)}\` | ${dt} | ${f.zoho?.stock ? '✓' : ''} |`);
    }
    L.push('');
  }

  L.push('## Things Zoho cannot express natively');
  L.push('');
  const gaps = [];
  for (const e of model.entities) {
    for (const c of e.constraints ?? []) {
      if (c.type === 'unique' && c.fields.length > 1) {
        gaps.push(`- **Composite unique** \`${e.zoho.module}\` (${c.fields.join(' + ')}) — no native composite unique field. Enforce with a custom function that COQL-counts matches on create/edit and rejects when > 0.`);
      }
      if (c.type === 'check') {
        gaps.push(`- **Check** \`${e.zoho.module}\`.\`${c.name}\` — \`${c.expr}\` — implement as a Zoho validation rule.`);
      }
    }
    for (const f of rollupFields(e)) {
      if (f.rollup.function === 'percent') {
        gaps.push(`- **Ratio rollup** \`${e.zoho.module}\`.\`${zohoApiName(f)}\` — Zoho rollups cannot divide. Create numerator and denominator count rollups plus a formula field.`);
      }
    }
    for (const f of e.fields) {
      if (f.derived_from) {
        gaps.push(`- **Denormalized field** \`${e.zoho.module}\`.\`${zohoApiName(f)}\` — copied from \`${f.derived_from}\`. Keep in step with a workflow field-update on create/edit (Postgres does this with a trigger).`);
      }
      if (f.type === 'time') {
        gaps.push(`- **Time-only field** \`${e.zoho.module}\`.\`${zohoApiName(f)}\` — stored as \`HH:MM\` text.`);
      }
    }
  }
  L.push(...[...new Set(gaps)]);
  L.push('');
  L.push('## Build order');
  L.push('');
  L.push('Lookups need their target module to exist, so modules are created in this order:');
  L.push('');
  L.push('```');
  L.push(buildOrder(model).map((e) => e.zoho.module).join(String.fromCharCode(10) + '  -> '));
  L.push('```');
  L.push('');
  writeFileSync(join(paths.docs, 'zoho-mapping.md'), L.join('\n'), 'utf8');
}

console.log(`wrote ${paths.docs}: erd.md, data-dictionary.md, zoho-mapping.md`);
