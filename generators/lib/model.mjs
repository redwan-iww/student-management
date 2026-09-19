// Loads and validates schema/model.yaml + schema/enums.yaml, and implements the
// naming rules documented at the top of model.yaml. Every generator uses this;
// none of them re-derive a name on their own.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const paths = {
  root: ROOT,
  schema: join(ROOT, 'schema'),
  build: join(ROOT, 'build'),
  docs: join(ROOT, 'docs'),
};

/**
 * Zoho rejects these as custom-field api_names with RESERVED_KEYWORD_NOT_ALLOWED.
 * Discovered the hard way: 'Notes' failed on a live createFields call.
 * A field that would generate one of these must set zoho.api_name explicitly.
 */
export const RESERVED_ZOHO_API_NAMES = new Set([
  'Notes', 'Tags', 'Tag', 'Owner', 'Attachments', 'Products', 'Contacts',
  'Accounts', 'Leads', 'Deals', 'Tasks', 'Events', 'Calls', 'id', 'Id',
  'Approval', 'Currency', 'Locked', 'Layout', 'Handler',
]);

/**
 * Zoho also rejects these as custom-field *labels* ("System keyword not allowed
 * in field label") -- a separate check from the api_name one above.
 */
export const RESERVED_ZOHO_FIELD_LABELS = new Set([
  'Notes', 'Tags', 'Tag', 'Owner', 'Attachments', 'Approval', 'Currency', 'Layout',
]);

/**
 * Zoho rejects these as *module* names too -- "You cannot have a module name
 * that matches a system keyword", raised against both Plural and Singular Name
 * in the Create Module form. A third, separate check from the two above:
 * 'Program' passes the field checks and fails here. Set zoho.module plus
 * zoho.singular_label / zoho.plural_label when an entity label lands on one.
 */
/**
 * Every Zoho *custom* module ships with these fields already present, so
 * creating one returns DUPLICATE_DATA ("API NAME DUPLICATE"). Observed on
 * CustomModule2 and hit live on Teachers.Email (2026-09-19). A spec field
 * landing on one of these must be declared zoho: { stock: true }.
 */
export const CUSTOM_MODULE_STOCK_FIELDS = new Set([
  'Name', 'Owner', 'Email', 'Secondary_Email', 'Email_Opt_Out', 'Tag',
  'Record_Image', 'Created_By', 'Modified_By', 'Created_Time', 'Modified_Time',
  'Last_Activity_Time', 'Unsubscribed_Mode', 'Unsubscribed_Time',
  'Locked__s', 'Record_Status__s', 'id',
]);

export const RESERVED_ZOHO_MODULE_NAMES = new Set([
  'Program', 'Programs', 'Note', 'Notes', 'Tag', 'Tags', 'Attachment', 'Attachments',
  'Event', 'Events', 'Task', 'Tasks', 'Call', 'Calls', 'User', 'Users', 'Role', 'Roles',
  'Profile', 'Profiles', 'Territory', 'Territories', 'Currency', 'Currencies',
  'Approval', 'Layout', 'Layouts', 'Field', 'Fields', 'Module', 'Modules',
  'Report', 'Reports', 'Dashboard', 'Dashboards', 'Owner', 'Portal', 'Portals',
]);

/** household_code -> Household_Code ; crm_user -> CRM_User */
// 'no' is deliberately absent: it means "number" here, so enrollment_no ->
// Enrollment_No, not Enrollment_NO.
const ACRONYMS = new Set(['crm', 'id', 'url', 'sms']);
export function pascalUnderscore(name) {
  return name
    .split('_')
    .map((part) =>
      ACRONYMS.has(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join('_');
}

/** SQL column for a field: references get an _id suffix, everything else is as written. */
export function sqlColumn(field) {
  if (field.sql?.column) return field.sql.column;
  if (field.type === 'reference') return `${field.name}_id`;
  if (field.type === 'user_reference') return `${field.name}_id`;
  return field.name;
}

/** Zoho api_name for a field. */
export function zohoApiName(field) {
  return field.zoho?.api_name ?? pascalUnderscore(field.name);
}

/** Base-table fields only: rollups are derived and never stored. */
export function storedFields(entity) {
  return entity.fields.filter((f) => f.type !== 'rollup');
}

export function rollupFields(entity) {
  return entity.fields.filter((f) => f.type === 'rollup');
}

export function loadModel() {
  const model = YAML.parse(readFileSync(join(paths.schema, 'model.yaml'), 'utf8'));
  const enums = YAML.parse(readFileSync(join(paths.schema, 'enums.yaml'), 'utf8'));

  const byName = new Map(model.entities.map((e) => [e.name, e]));
  model.entityByName = byName;
  model.enums = enums.enums;

  validate(model);
  return model;
}

function validate(model) {
  const problems = [];
  const seenEntity = new Set();

  for (const entity of model.entities) {
    if (seenEntity.has(entity.name)) problems.push(`duplicate entity: ${entity.name}`);
    seenEntity.add(entity.name);

    if (!entity.zoho?.module) problems.push(`${entity.name}: missing zoho.module`);

    // Module names get their own reserved-keyword check -- see
    // RESERVED_ZOHO_MODULE_NAMES. Both labels and the api_name are rejected.
    const zSingular = entity.zoho?.singular_label ?? entity.label;
    const zPlural = entity.zoho?.plural_label ?? entity.plural_label ?? `${entity.label}s`;
    for (const [what, value] of [["api_name", entity.zoho?.module], ["singular_label", zSingular], ["plural_label", zPlural]]) {
      if (value && RESERVED_ZOHO_MODULE_NAMES.has(value)) {
        problems.push(
          `${entity.name}: module ${what} '${value}' is a Zoho system keyword -- ` +
            'set zoho.module / zoho.singular_label / zoho.plural_label explicitly',
        );
      }
    }

    const seenField = new Set();
    const seenColumn = new Set();
    const seenApi = new Set();

    for (const field of entity.fields) {
      const where = `${entity.name}.${field.name}`;
      if (seenField.has(field.name)) problems.push(`duplicate field: ${where}`);
      seenField.add(field.name);

      if (field.type === 'enum' || field.type === 'multi_enum') {
        if (!field.enum) problems.push(`${where}: enum field has no 'enum:' key`);
        else if (!model.enums[field.enum]) problems.push(`${where}: unknown enum '${field.enum}'`);
        else if (field.default !== undefined && !model.enums[field.enum].values.includes(field.default)) {
          problems.push(`${where}: default '${field.default}' is not a value of ${field.enum}`);
        }
      }

      if (field.type === 'reference') {
        if (!field.ref) problems.push(`${where}: reference has no 'ref:' key`);
        else if (!model.entityByName.has(field.ref)) problems.push(`${where}: unknown ref '${field.ref}'`);
        if (!field.on_delete) problems.push(`${where}: reference has no on_delete`);
      }

      if (field.type === 'rollup') {
        const r = field.rollup;
        if (!r) problems.push(`${where}: rollup has no 'rollup:' block`);
        else {
          const src = model.entityByName.get(r.from);
          if (!src) problems.push(`${where}: rollup.from '${r.from}' is not an entity`);
          else if (!src.fields.some((f) => f.name === r.via)) {
            problems.push(`${where}: rollup.via '${r.via}' is not a field of ${r.from}`);
          }
        }
      }

      if (field.type !== 'rollup') {
        const col = sqlColumn(field);
        if (seenColumn.has(col)) problems.push(`${entity.name}: duplicate SQL column '${col}'`);
        seenColumn.add(col);
      }

      const api = zohoApiName(field);
      if (seenApi.has(api)) problems.push(`${entity.name}: duplicate Zoho api_name '${api}'`);
      if (RESERVED_ZOHO_API_NAMES.has(api) && !field.zoho?.stock) {
        problems.push(
          `${where}: Zoho api_name '${api}' is a reserved keyword -- set zoho.api_name explicitly`,
        );
      }
      if (RESERVED_ZOHO_FIELD_LABELS.has(field.label) && !field.zoho?.stock) {
        problems.push(`${where}: field label '${field.label}' is a Zoho reserved keyword`);
      }
      // Custom modules already own these api_names -- createFields returns
      // DUPLICATE_DATA. Only applies to modules Zoho generates as custom.
      if (entity.zoho?.strategy !== 'extend_standard' && CUSTOM_MODULE_STOCK_FIELDS.has(api) && !field.zoho?.stock) {
        problems.push(
          `${where}: api_name '${api}' is a stock field on every Zoho custom module -- ` +
            'declare zoho: { stock: true } instead of creating it',
        );
      }
      if (field.label.length > 25) {
        problems.push(`${where}: field label '${field.label}' exceeds Zoho's 25-char limit`);
      }
      seenApi.add(api);
    }

    for (const c of entity.constraints ?? []) {
      for (const f of c.fields ?? []) {
        if (!seenField.has(f)) problems.push(`${entity.name}.${c.name}: unknown field '${f}'`);
      }
    }
  }

  for (const idx of model.indexes ?? []) {
    const entity = model.entityByName.get(idx.entity);
    if (!entity) { problems.push(`index ${idx.name}: unknown entity '${idx.entity}'`); continue; }
    for (const f of idx.fields) {
      if (!entity.fields.some((x) => x.name === f)) {
        problems.push(`index ${idx.name}: unknown field '${idx.entity}.${f}'`);
      }
    }
  }

  if (problems.length) {
    throw new Error(`schema validation failed:\n  - ${problems.join('\n  - ')}`);
  }
}

/**
 * Module/table creation order: a target must exist before anything references it.
 * Used by gen-zoho (Zoho createModules order) and gen-docs (documented order).
 */
export function buildOrder(model) {
  const pending = new Map(model.entities.map((e) => [e.name, e]));
  const done = new Set();
  const order = [];

  while (pending.size) {
    let progressed = false;
    for (const [name, entity] of [...pending]) {
      const deps = storedFields(entity)
        .filter((f) => f.type === 'reference')
        .map((f) => f.ref)
        .filter((ref) => ref !== name); // self-references resolve after creation
      if (deps.every((d) => done.has(d) || !pending.has(d))) {
        order.push(entity);
        done.add(name);
        pending.delete(name);
        progressed = true;
      }
    }
    if (!progressed) {
      // Cycle: the remainder still works, because lookups are created in a
      // second pass that runs after every module exists.
      order.push(...pending.values());
      break;
    }
  }
  return order;
}
