// Transport: a thin typed wrapper over the REST API.
//
// The route and filter syntax copy PostgREST, which is what Supabase exposes:
//
//   select('terms', { status: 'eq.Open', order: 'start_date.asc' })
//   insert('attendance', rows)          // one object or an array
//   update('class_sessions', 12, {...})
//
// Moving to Supabase means pointing BASE at the project URL and adding the
// apikey header -- the paths, operators and response shapes are the same. That
// is the whole reason this file speaks PostgREST rather than something bespoke.

import type { RowTypes, TableName } from '../generated/db-types';

/**
 * Same-origin in dev: the Vite proxy forwards /api to the local Express server
 * (see vite.config.ts). Set VITE_API_URL to point somewhere else.
 */
const BASE = import.meta.env.VITE_API_URL ?? '/api';

export interface ApiError extends Error {
  code: string;
  status: number;
}

function apiError(status: number, code: string, message: string): ApiError {
  const err = new Error(message) as ApiError;
  err.name = 'ApiError';
  err.code = code;
  err.status = status;
  return err;
}

/**
 * Turns any failure into something a person can act on.
 *
 * The server answers errors as { code, message }; a network failure has
 * neither. Both end up as an Error with a readable message, so callers never
 * have to render an object.
 */
export function describeError(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
    const e = err as { code: unknown; message: unknown };
    return `${String(e.code)}: ${String(e.message)}`;
  }
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch (cause) {
    throw apiError(0, 'NETWORK', `cannot reach the API at ${BASE}. Is \`npm run server\` running?`);
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    const e = (body ?? {}) as { code?: string; message?: string };
    throw apiError(res.status, e.code ?? String(res.status), e.message ?? res.statusText);
  }
  return body as T;
}

/** PostgREST-style filters: { status: 'eq.Open', order: 'name.asc', limit: 50 } */
export type Filters = Record<string, string | number | undefined>;

function queryString(filters: Filters = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

/** Row count per table, in one request -- see the setup page's sidebar. */
export function counts(): Promise<Record<TableName, number>> {
  return request<Record<TableName, number>>('/_counts');
}

export function select<T extends TableName>(
  table: T,
  filters?: Filters,
): Promise<RowTypes[T][]> {
  return request<RowTypes[T][]>(`/${table}${queryString(filters)}`);
}

export async function selectOne<T extends TableName>(
  table: T,
  id: number | string,
): Promise<RowTypes[T] | null> {
  try {
    return await request<RowTypes[T]>(`/${table}/${id}`);
  } catch (err) {
    if ((err as ApiError).status === 404) return null;
    throw err;
  }
}

/** Insert one row or many. Many go in a single request and one transaction. */
export function insert<T extends TableName>(
  table: T,
  rows: Partial<RowTypes[T]> | Array<Partial<RowTypes[T]>>,
): Promise<RowTypes[T][]> {
  return request<RowTypes[T][]>(`/${table}`, {
    method: 'POST',
    body: JSON.stringify(rows),
  });
}

export function update<T extends TableName>(
  table: T,
  id: number | string,
  patch: Partial<RowTypes[T]>,
): Promise<RowTypes[T]> {
  return request<RowTypes[T]>(`/${table}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function remove(table: TableName, id: number | string): Promise<void> {
  return request<void>(`/${table}/${id}`, { method: 'DELETE' });
}
