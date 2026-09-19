// schema/model.yaml -> build/zoho/*.json
//
// Emits ready-to-send Zoho CRM metadata payloads:
//   build/zoho/00-plan.json          ordered build plan + dependency order
//   build/zoho/modules.json          createModules payload (strategy: create)
//   build/zoho/fields/<Module>.json  createFields payload, split scalar/lookup
//   build/zoho/rollups.json          rollup summary fields (added last)
//   build/zoho/validations.json      composite-unique rules Zoho cannot express
//
// Lookups are separated from scalar fields because a lookup cannot be created
// until its target module exists.

import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadModel, paths, zohoApiName, storedFields, rollupFields, buildOrder } from './lib/model.mjs';

const model = loadModel();
const outDir = join(paths.build, 'zoho');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, 'fields'), { recursive: true });

const write = (rel, data) => {
  const file = join(outDir, rel);
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
  return file;
};

// ---------------------------------------------------------------------------
// Type mapping: canonical -> Zoho data_type + ui_type-shaping properties
// ---------------------------------------------------------------------------
function zohoField(field, entity) {
  const base = { field_label: field.label, api_name: zohoApiName(field) };
  // static_text tooltips cap at 35 chars; info_icon allows 255.
  if (field.note) base.tooltip = { name: 'info_icon', value: field.note.slice(0, 255) };

  switch (field.type) {
    case 'text':
      return { ...base, data_type: 'text', length: field.length ?? 255 };
    case 'textarea':
      return { ...base, data_type: 'textarea', textarea: { type: 'small' } };
    case 'email':
      return { ...base, data_type: 'email', length: 100 };
    case 'phone':
      return { ...base, data_type: 'phone', length: 30 };
    case 'url':
      return { ...base, data_type: 'website', length: 255 };
    case 'image':
      return { ...base, data_type: 'profileimage' };
    case 'integer':
      return { ...base, data_type: 'integer', length: 9 };
    case 'decimal':
      return { ...base, data_type: 'double', length: field.precision ?? 12, decimal_place: field.scale ?? 2 };
    case 'currency':
      return { ...base, data_type: 'currency', length: 16, decimal_place: 2,
        currency: { precision: '2', rounding_option: 'normal' } };
    case 'percent':
      return { ...base, data_type: 'percent', length: 5, decimal_place: 2 };
    case 'boolean':
      return { ...base, data_type: 'boolean' };
    case 'date':
      return { ...base, data_type: 'date' };
    case 'datetime':
      return { ...base, data_type: 'datetime' };
    case 'time':
      // Zoho has no time-only type; a 5-char text field holding HH:MM.
      return { ...base, data_type: 'text', length: 5, _note: 'no native time type in Zoho CRM; HH:MM text' };
    case 'enum':
      return {
        ...base,
        data_type: 'picklist',
        pick_list_values: model.enums[field.enum].values.map((v, i) => ({
          display_value: v,
          actual_value: v,
          sequence_number: i + 1,
        })),
      };
    case 'multi_enum':
      return {
        ...base,
        data_type: 'multiselectpicklist',
        pick_list_values: model.enums[field.enum].values.map((v, i) => ({
          display_value: v,
          actual_value: v,
          sequence_number: i + 1,
        })),
      };
    case 'autonumber':
      return {
        ...base,
        data_type: 'autonumber',
        auto_number: { prefix: field.format.split('{')[0], start_number: '1', suffix: '' },
      };
    case 'user_reference':
      return { ...base, data_type: 'userlookup' };
    case 'reference': {
      const target = model.entityByName.get(field.ref);
      return {
        ...base,
        data_type: 'lookup',
        lookup: {
          module: { api_name: target.zoho.module },
          // Label of the related list this lookup creates on the target module.
          display_label: (entity.plural_label ?? entity.label).slice(0, 25),
        },
      };
    }
    default:
      throw new Error(`unmapped type for Zoho: ${field.type}`);
  }
}

function applyFlags(payload, field) {
  if (field.required) payload.system_mandatory = true;
  // Zoho: "unique is not supported for data type autonumber" -- an auto-number
  // is inherently unique, so the flag is dropped for this target only. The SQL
  // target still emits a UNIQUE constraint.
  if (field.unique && field.type !== 'autonumber') payload.unique = { case_sensitive: false };
  if (field.default !== undefined && ['enum', 'text', 'integer', 'boolean', 'currency', 'decimal'].includes(field.type)) {
    payload.default_value = String(field.default).slice(0, 25);
  }
  return payload;
}

const order = buildOrder(model);


// ---------------------------------------------------------------------------
// modules.json -- only entities whose strategy is `create`
// ---------------------------------------------------------------------------
const toCreate = order.filter((e) => e.zoho.strategy === 'create');
// Org-based modules must name the profiles that can see them -- and profile IDs
// are ORG-SPECIFIC. Pasting IDs from one org into another fails with
// "Invalid profile id", so they are deliberately left empty here and resolved
// against the target org at apply time (getProfiles -> normal_profile).
// Optional: schema/target-org.yaml supplies them so the payload ships filled in.
let PROFILES = [];
let TEAM_SPACE = null;
let TARGET_ORG = null;
try {
  const YAML = (await import('yaml')).default;
  const cfg = YAML.parse(readFileSync(join(paths.schema, 'target-org.yaml'), 'utf8'));
  TARGET_ORG = cfg.org ?? null;
  PROFILES = (cfg.profiles ?? []).map((p) => ({ id: p.id, _name: p.name }));
  TEAM_SPACE = cfg.team_space ?? null;
} catch {
  // No target-org.yaml -- emit the placeholder form.
}

write('modules.json', {
  _comment:
    'POST to ZohoCRM_createModules, one entry at a time, in this order. ' +
    'Verify each with getModuleByApiName before moving on.',
  _target_org: TARGET_ORG,
  ...(PROFILES.length
    ? {}
    : {
        _profiles_required:
          'profiles[] is EMPTY and org_based modules require it. Profile IDs are ' +
          'org-specific -- run getProfiles(type=normal_profile) against the TARGET ' +
          'org and fill schema/target-org.yaml, then re-run npm run gen:zoho. ' +
          'Reusing IDs from another org fails with "Invalid profile id".',
      }),
  modules: toCreate.map((e) => {
    const teamBased = e.zoho.access_type === 'team_based';
    return {
      _entity: e.name,
      singular_label: e.zoho.singular_label ?? e.label,
      plural_label: e.zoho.plural_label ?? e.plural_label ?? `${e.label}s`,
      api_name: e.zoho.module,
      access_type: e.zoho.access_type ?? 'org_based',
      // A team module answers to its team space's five private profiles
      // (Admins/Managers/Members/Participants/Requesters), NOT to org
      // profiles. Sending org profile ids for one is meaningless.
      profiles: teamBased ? (TEAM_SPACE?.profiles ?? []).map((p) => ({ id: p.id, _name: p.name })) : PROFILES,
      ...(teamBased && TEAM_SPACE ? { _team_space: TEAM_SPACE.name, private_profile: { name: 'Admins' } } : {}),
      ...(e.zoho.collision_risk ? { _collision_risk: e.zoho.collision_risk } : {}),
    };
  }),
});

// ---------------------------------------------------------------------------
// fields/<Module>.json -- scalar pass then lookup pass
// ---------------------------------------------------------------------------
const fieldFiles = [];
for (const entity of order) {
  const scalars = [];
  const lookups = [];
  const relabels = [];

  for (const field of storedFields(entity)) {
    if (field.zoho?.stock) { if (field.zoho.relabel) relabels.push({ api_name: zohoApiName(field), new_label: field.label, _entity_field: field.name }); continue; }
    const payload = applyFlags(zohoField(field, entity), field);
    payload._entity_field = field.name;
    (field.type === 'reference' || field.type === 'user_reference' ? lookups : scalars).push(payload);
  }

  const rel = `fields/${entity.zoho.module}.json`;
  write(rel, {
    _entity: entity.name,
    module: entity.zoho.module,
    strategy: entity.zoho.strategy,
    _comment:
      'Send `scalar_fields` first (ZohoCRM_createFields), then `lookup_fields` ' +
      'once every target module exists. Stock fields already present in Zoho are omitted.',
    scalar_fields: scalars,
    lookup_fields: lookups,
    // Stock fields that only need their label changed -- updateField, not createFields.
    relabel_stock_fields: relabels,
  });
  fieldFiles.push({ entity: entity.name, module: entity.zoho.module, file: rel,
    scalars: scalars.length, lookups: lookups.length, relabels: relabels.length,
    mandatory: [...scalars, ...lookups].filter((f) => f.system_mandatory).length });
}

// ---------------------------------------------------------------------------
// rollups.json -- added last, once both modules and the lookup linking them exist
// ---------------------------------------------------------------------------
const rollups = [];
for (const entity of model.entities) {
  for (const field of rollupFields(entity)) {
    const r = field.rollup;
    const src = model.entityByName.get(r.from);
    const viaField = src.fields.find((f) => f.name === r.via);
    rollups.push({
      _entity: entity.name,
      module: entity.zoho.module,
      field_label: field.label,
      api_name: zohoApiName(field),
      data_type: r.function === 'percent' ? 'percent' : 'integer',
      rollup_summary: {
        based_on: { api_name: src.zoho.module },
        // The lookup on the child module that points back at this record.
        linking_field: zohoApiName(viaField),
        function: r.function === 'percent' ? 'count' : r.function,
        ...(r.where ? { _criteria_note: r.where } : {}),
        ...(r.of ? { _denominator_note: r.of } : {}),
      },
      ...(r.function === 'percent'
        ? {
            _manual:
              'Zoho rollup summaries cannot express a ratio. Create two count ' +
              'rollups (numerator, denominator) and a formula field dividing them.',
          }
        : {}),
    });
  }
}
write('rollups.json', {
  _comment:
    'Apply AFTER modules and lookups exist. Zoho rollup criteria are set in the ' +
    'UI/API as a criteria block; the _criteria_note carries the canonical filter.',
  rollups,
});

// ---------------------------------------------------------------------------
// validations.json -- composite uniqueness, which Zoho has no native field for
// ---------------------------------------------------------------------------
const validations = [];
for (const entity of model.entities) {
  for (const c of entity.constraints ?? []) {
    if (c.type !== 'unique') continue;
    const apiNames = c.fields.map((n) => zohoApiName(entity.fields.find((f) => f.name === n)));
    validations.push({
      _entity: entity.name,
      module: entity.zoho.module,
      name: c.name,
      fields: apiNames,
      enforcement:
        'Custom function on create/edit: COQL-count existing records matching all ' +
        `fields (${apiNames.join(' + ')}); reject when count > 0.`,
      ...(c.note ? { note: c.note } : {}),
    });
  }
  for (const c of entity.constraints ?? []) {
    if (c.type !== 'check') continue;
    validations.push({
      _entity: entity.name,
      module: entity.zoho.module,
      name: c.name,
      expression: c.expr,
      enforcement: 'Zoho validation rule on the listed expression.',
    });
  }
}
write('validations.json', {
  _comment: 'Constraints the Zoho field model cannot express natively.',
  validations,
});

// ---------------------------------------------------------------------------
// 00-plan.json -- the ordered runbook
// ---------------------------------------------------------------------------
// Counts for the two post-create passes that are not createFields calls.
const mandatoryCount = fieldFiles.reduce((n, f) => n + f.mandatory, 0);
const relabelCount = fieldFiles.reduce((n, f) => n + f.relabels, 0);

const plan = {
  _comment: 'Execute top to bottom. Each step is idempotent-checkable with getFields / getModuleByApiName.',
  generated_from: 'schema/model.yaml',
  _access_model: {
    org_based: order.filter((e) => (e.zoho.access_type ?? 'org_based') === 'org_based').map((e) => e.zoho.module),
    team_based: order.filter((e) => e.zoho.access_type === 'team_based').map((e) => e.zoho.module),
    note: 'Two permission systems. org_based modules answer to org profiles + role hierarchy + sharing rules; team_based modules answer to their team space\'s five private profiles. See docs/roles-enforcement.md.',
  },
  steps: [
    { step: 0, action: 'assert target org', detail: TARGET_ORG?.zgid
        ? `getOrganization must return zgid ${TARGET_ORG.zgid} (${TARGET_ORG.name}). Abort on any other org -- the profile IDs in modules.json and the module IDs below are org-specific.`
        : 'getOrganization and confirm the org matches schema/target-org.yaml before any write. Profile IDs are org-specific.' },
    { step: 1, action: 'audit', detail: 'getModuleByApiName + getRecordCount on Courses (CustomModule2) and Students (CustomModule45) before any write.' },
    { step: 2, action: 'createModules', file: 'modules.json', count: toCreate.length },
    { step: 3, action: 'createFields (scalar pass)', files: fieldFiles.map((f) => f.file) },
    { step: 4, action: 'createFields (lookup pass)', files: fieldFiles.filter((f) => f.lookups).map((f) => f.file) },
    { step: 5, action: 'rollup summaries', file: 'rollups.json', count: rollups.length },
    { step: 6, action: 'validation rules / custom functions', file: 'validations.json', count: validations.length },
    // Mandatory is layout config, not field metadata: system_mandatory sent to
    // createFields returns SUCCESS but does not take effect. See docs/architecture.md.
    { step: 7, action: 'mandatory flags (layout API)', count: mandatoryCount, detail:
        `getLayouts per module, then updateLayout marking required the ${mandatoryCount} fields flagged system_mandatory in fields/*.json. ` +
        'createFields silently ignores the flag and getFields does not report it reliably, so this step is not optional.' },
    { step: 8, action: 'relabel stock fields', count: relabelCount, detail:
        `updateField on the ${relabelCount} stock field${relabelCount === 1 ? "" : "s"} listed under relabel_stock_fields. Needs ZohoCRM.settings.fields.ALL.` },
    { step: 9, action: 'blueprint', detail: 'Admissions.Stage -- see schema/model.yaml entities[admissions].zoho.blueprint. UI only; no MCP/API coverage.' },
  ],
  module_order: order.map((e) => ({ entity: e.name, module: e.zoho.module, strategy: e.zoho.strategy })),
};
write('00-plan.json', plan);

console.log(`wrote ${outDir}`);
console.log(`  modules to create : ${toCreate.length}`);
console.log(`  field files       : ${fieldFiles.length}`);
console.log(`  scalar fields     : ${fieldFiles.reduce((n, f) => n + f.scalars, 0)}`);
console.log(`  lookup fields     : ${fieldFiles.reduce((n, f) => n + f.lookups, 0)}`);
console.log(`  mandatory (layout): ${mandatoryCount}`);
console.log(`  stock relabels    : ${relabelCount}`);
console.log(`  rollups           : ${rollups.length}`);
console.log(`  validations       : ${validations.length}`);
console.log(`  module order      : ${order.map((e) => e.zoho.module).join(' -> ')}`);
