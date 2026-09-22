// Generic REST over the model's tables.
//
// The route shape and the filter syntax deliberately copy PostgREST, which is
// what Supabase exposes:
//
//   GET    /api/terms?status=eq.Open&order=start_date.asc
//   GET    /api/classes?term_id=eq.4&select=*
//   POST   /api/attendance          (one object, or an array for bulk)
//   PATCH  /api/attendance/12
//   DELETE /api/attendance/12
//
// Keeping that dialect means the browser client written against this server
// also speaks to Supabase later: same paths, same operators, same responses.
//
// Table and column names are validated against schema/model.yaml before they
// reach SQL -- identifiers cannot be bound as parameters, so an allow-list is
// the only safe way to accept them from a request.

import { Router } from 'express';
import { loadModel, sqlColumn, storedFields, rollupFields } from '../generators/lib/model.mjs';

const model = loadModel();

/** table name -> { columns, rollups, view } */
const TABLES = new Map();
for (const entity of model.entities) {
  const table = entity.sql?.table ?? entity.name;
  const columns = new Set(['id', 'created_at', 'updated_at']);
  for (const f of storedFields(entity)) columns.add(sqlColumn(f));
  const rollups = rollupFields(entity).map((f) => f.name);
  TABLES.set(table, {
    columns,
    rollups,
    // Reading through the view brings the rollup columns with it; writes always
    // go to the base table.
    view: rollups.length ? `v_${table}` : table,
  });
}

const OPERATORS = {
  eq: '=', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'LIKE',
};

const RESERVED_PARAMS = new Set(['select', 'order', 'limit', 'offset']);

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const q = (id) => `"${id}"`;

function tableOf(name) {
  const meta = TABLES.get(name);
  if (!meta) throw new HttpError(404, 'UNKNOWN_TABLE', `no such table: ${name}`);
  return meta;
}

function assertColumn(meta, table, col) {
  if (!meta.columns.has(col) && !meta.rollups.includes(col)) {
    throw new HttpError(400, 'UNKNOWN_COLUMN', `no column "${col}" on ${table}`);
  }
}

/** `status=eq.Open` / `id=in.(1,2,3)` -> a WHERE fragment plus bound values. */
function buildWhere(meta, table, query) {
  const clauses = [];
  const values = [];

  for (const [key, raw] of Object.entries(query)) {
    if (RESERVED_PARAMS.has(key)) continue;
    assertColumn(meta, table, key);

    const value = Array.isArray(raw) ? raw[0] : raw;
    const dot = String(value).indexOf('.');
    const op = dot === -1 ? 'eq' : String(value).slice(0, dot);
    const operand = dot === -1 ? String(value) : String(value).slice(dot + 1);

    if (op === 'is') {
      if (operand !== 'null') throw new HttpError(400, 'BAD_FILTER', `is.${operand} is not supported`);
      clauses.push(`${q(key)} IS NULL`);
      continue;
    }
    if (op === 'in') {
      const list = operand.replace(/^\(|\)$/g, '').split(',').filter((s) => s !== '');
      if (list.length === 0) {
        clauses.push('1 = 0');
        continue;
      }
      clauses.push(`${q(key)} IN (${list.map(() => '?').join(', ')})`);
      values.push(...list);
      continue;
    }
    const sqlOp = OPERATORS[op];
    if (!sqlOp) throw new HttpError(400, 'BAD_OPERATOR', `unknown operator "${op}"`);
    clauses.push(`${q(key)} ${sqlOp} ?`);
    values.push(operand);
  }

  return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', values };
}

function buildOrder(meta, table, order) {
  if (!order) return '';
  const parts = String(order).split(',').map((piece) => {
    const [col, dir = 'asc'] = piece.split('.');
    assertColumn(meta, table, col);
    if (!['asc', 'desc'].includes(dir)) {
      throw new HttpError(400, 'BAD_ORDER', `order direction must be asc or desc, got "${dir}"`);
    }
    return `${q(col)} ${dir.toUpperCase()}`;
  });
  return ` ORDER BY ${parts.join(', ')}`;
}

/**
 * SQLite stores booleans as 0/1 and has no array type; the client works in
 * real booleans and arrays, so the boundary converts both ways.
 */
function makeCodecs() {
  const byTable = new Map();
  for (const entity of model.entities) {
    const table = entity.sql?.table ?? entity.name;
    const bools = [];
    const jsons = [];
    for (const f of storedFields(entity)) {
      if (f.type === 'boolean') bools.push(sqlColumn(f));
      if (f.type === 'multi_enum') jsons.push(sqlColumn(f));
    }
    byTable.set(table, { bools, jsons });
  }
  return byTable;
}
const CODECS = makeCodecs();

function decodeRow(table, row) {
  if (!row) return row;
  const { bools, jsons } = CODECS.get(table) ?? { bools: [], jsons: [] };
  const out = { ...row };
  for (const c of bools) if (c in out && out[c] !== null) out[c] = out[c] === 1;
  for (const c of jsons) {
    if (c in out && typeof out[c] === 'string') {
      try { out[c] = JSON.parse(out[c]); } catch { /* leave the raw text */ }
    }
  }
  return out;
}

function encodeValue(table, col, value) {
  const { bools, jsons } = CODECS.get(table) ?? { bools: [], jsons: [] };
  if (bools.includes(col)) return value === null || value === undefined ? null : value ? 1 : 0;
  if (jsons.includes(col)) return value === null || value === undefined ? null : JSON.stringify(value);
  if (value === undefined) return null;
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return value;
}

export function createApi(db) {
  const router = Router();

  router.get('/_tables', (_req, res) => {
    res.json([...TABLES.keys()].map((t) => ({ table: t, rollups: TABLES.get(t).rollups })));
  });

  router.get('/:table', (req, res, next) => {
    try {
      const table = req.params.table;
      const meta = tableOf(table);
      const where = buildWhere(meta, table, req.query);
      const order = buildOrder(meta, table, req.query.order);

      let sql = `SELECT * FROM ${q(meta.view)}${where.sql}${order}`;
      const limit = Number(req.query.limit);
      if (Number.isFinite(limit) && limit > 0) {
        sql += ` LIMIT ${Math.floor(limit)}`;
        const offset = Number(req.query.offset);
        if (Number.isFinite(offset) && offset > 0) sql += ` OFFSET ${Math.floor(offset)}`;
      }

      const rows = db.prepare(sql).all(...where.values);
      res.json(rows.map((r) => decodeRow(table, r)));
    } catch (err) { next(err); }
  });

  router.get('/:table/:id', (req, res, next) => {
    try {
      const table = req.params.table;
      const meta = tableOf(table);
      const row = db.prepare(`SELECT * FROM ${q(meta.view)} WHERE "id" = ?`).get(req.params.id);
      if (!row) throw new HttpError(404, 'NOT_FOUND', `${table} ${req.params.id} not found`);
      res.json(decodeRow(table, row));
    } catch (err) { next(err); }
  });

  router.post('/:table', (req, res, next) => {
    try {
      const table = req.params.table;
      const meta = tableOf(table);
      const payload = Array.isArray(req.body) ? req.body : [req.body];
      if (payload.length === 0) return res.status(201).json([]);

      // One transaction for the whole batch: a bulk insert either lands or it
      // does not, which is what the CRM bulk endpoint did too.
      const created = [];
      db.exec('BEGIN');
      try {
        for (const item of payload) {
          const cols = Object.keys(item).filter((c) => {
            assertColumn(meta, table, c);
            return c !== 'id' && meta.columns.has(c);
          });
          const sql =
            `INSERT INTO ${q(table)} (${cols.map(q).join(', ')}) ` +
            `VALUES (${cols.map(() => '?').join(', ')})`;
          const values = cols.map((c) => encodeValue(table, c, item[c]));
          const info = db.prepare(sql).run(...values);
          created.push(Number(info.lastInsertRowid));
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      const rows = created.map((id) =>
        decodeRow(table, db.prepare(`SELECT * FROM ${q(meta.view)} WHERE "id" = ?`).get(id)),
      );
      res.status(201).json(rows);
    } catch (err) { next(err); }
  });

  router.patch('/:table/:id', (req, res, next) => {
    try {
      const table = req.params.table;
      const meta = tableOf(table);
      const cols = Object.keys(req.body).filter((c) => {
        assertColumn(meta, table, c);
        return c !== 'id' && meta.columns.has(c);
      });
      if (cols.length === 0) throw new HttpError(400, 'NO_FIELDS', 'nothing to update');

      const sql = `UPDATE ${q(table)} SET ${cols.map((c) => `${q(c)} = ?`).join(', ')} WHERE "id" = ?`;
      const values = cols.map((c) => encodeValue(table, c, req.body[c]));
      const info = db.prepare(sql).run(...values, req.params.id);
      if (info.changes === 0) throw new HttpError(404, 'NOT_FOUND', `${table} ${req.params.id} not found`);

      res.json(decodeRow(table, db.prepare(`SELECT * FROM ${q(meta.view)} WHERE "id" = ?`).get(req.params.id)));
    } catch (err) { next(err); }
  });

  router.delete('/:table/:id', (req, res, next) => {
    try {
      const table = req.params.table;
      tableOf(table);
      const info = db.prepare(`DELETE FROM ${q(table)} WHERE "id" = ?`).run(req.params.id);
      if (info.changes === 0) throw new HttpError(404, 'NOT_FOUND', `${table} ${req.params.id} not found`);
      res.status(204).end();
    } catch (err) { next(err); }
  });

  /**
   * SQLite states constraint failures in its own terms:
   *
   *   "FOREIGN KEY constraint failed"
   *   "UNIQUE constraint failed: terms.term_code"
   *
   * The first says nothing about which record is in the way, and the second
   * names a column but not what to do. Both reach a person filling in a form,
   * so they are restated before they leave the server.
   */
  function explain(err) {
    const raw = String(err.message ?? '');

    let m = /UNIQUE constraint failed: ([\w.]+)/.exec(raw);
    if (m) {
      const col = m[1].split('.').pop();
      return { code: 'DUPLICATE', message: `another record already uses that ${col}` };
    }
    m = /NOT NULL constraint failed: ([\w.]+)/.exec(raw);
    if (m) {
      const col = m[1].split('.').pop();
      return { code: 'REQUIRED', message: `${col} is required` };
    }
    m = /CHECK constraint failed: (\w+)/.exec(raw);
    if (m) {
      return { code: 'INVALID', message: `value not allowed here (${m[1]})` };
    }
    if (/FOREIGN KEY constraint failed/.test(raw)) {
      return {
        code: 'IN_USE',
        message:
          'this record is still referenced by other records, or points at one ' +
          'that does not exist. Remove or repoint those first.',
      };
    }
    return null;
  }

  router.use((err, _req, res, _next) => {
    const friendly = err.status ? null : explain(err);
    const status = err.status ?? 400;
    const code = friendly?.code ?? err.code ?? 'SQLITE_ERROR';
    const message = friendly?.message ?? err.message;
    if (status >= 500) console.error('[api]', err);
    res.status(status).json({ code, message });
  });

  return router;
}
