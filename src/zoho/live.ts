// A real ZOHO global for local development -- same shape as the mock, but every
// call reaches the actual CRM.
//
// Mirrors mock.ts exactly: it installs at the SDK boundary, so client.ts, both
// tab apps and the generated ZOHO_MODULES map run completely unchanged. Only
// the transport differs -- here it is Zoho's REST v8 API instead of an
// in-memory array.
//
// Requests go to `/zoho/...` on the Vite dev server, never to zohoapis.com
// directly. The dev-server proxy (see vite.config.ts) attaches the OAuth
// header. Two reasons that indirection is not optional:
//
//   - CORS. zohoapis.com sends no Access-Control-Allow-Origin for localhost,
//     so a browser fetch straight to it is blocked before it is even sent.
//   - Secrecy. The refresh token and client secret stay in the Node process.
//     Nothing sensitive is ever shipped to the browser bundle.
//
// Dev-only, exactly like the mock: installed behind `import.meta.env.DEV`, so
// it is tree-shaken out of production builds. In production the real SDK
// script supplies the ZOHO global and this file is absent.
//
// What is still NOT real: the embeddedApp handshake. Outside a CRM frame there
// is no parent to answer it, so `init()` resolves immediately and PageLoad
// fires with `{}`. That matches what a web tab actually receives (a web tab has
// no record context), but it does not exercise the postMessage handshake. For
// that, use `zet run` and register its URL as the widget URL.

const BASE = '/zoho/crm/v8';

type Json = Record<string, unknown>;

/**
 * Zoho answers "no matches" with `204 No Content` and an empty body, not with
 * `{"data":[]}`. Parsing that as JSON throws, so it is handled before the read.
 */
async function call(path: string, init?: RequestInit): Promise<Json> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });

  if (res.status === 204) return { data: [] };

  const text = await res.text();
  if (!text) return { data: [] };

  let body: Json;
  try {
    body = JSON.parse(text) as Json;
  } catch {
    throw new Error(`Zoho returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }

  // A transport-level failure (401, 429, 500) never reaches client.ts's
  // assertWrote, which only inspects per-record codes -- so surface it here.
  if (!res.ok) {
    const code = typeof body.code === 'string' ? body.code : String(res.status);
    const message = typeof body.message === 'string' ? body.message : res.statusText;
    throw new Error(`${code}: ${message}`);
  }
  return body;
}

const api = {
  async getRecord({ Entity, RecordID }: { Entity: string; RecordID: string }) {
    return call(`/${Entity}/${RecordID}`);
  },

  async getAllRecords({
    Entity, sort_by, sort_order, per_page = 200, page = 1,
  }: { Entity: string; sort_by?: string; sort_order?: string; per_page?: number; page?: number }) {
    const q = new URLSearchParams({ per_page: String(per_page), page: String(page) });
    if (sort_by) q.set('sort_by', sort_by);
    if (sort_order) q.set('sort_order', sort_order);
    return call(`/${Entity}?${q}`);
  },

  async searchRecord({
    Entity, Type, Query, per_page = 200, page = 1,
  }: { Entity: string; Type: string; Query: string; per_page?: number; page?: number }) {
    // client.ts only ever builds `criteria` queries; the other search types map
    // to their own query params, so they are rejected rather than silently
    // sent as criteria and returning nonsense.
    if (Type !== 'criteria') throw new Error(`live adapter supports Type 'criteria', got '${Type}'`);
    const q = new URLSearchParams({
      criteria: Query,
      per_page: String(per_page),
      page: String(page),
    });
    return call(`/${Entity}/search?${q}`);
  },

  async insertRecord({
    Entity, APIData, Trigger,
  }: { Entity: string; APIData: Json | Json[]; Trigger?: string[] }) {
    // APIData may be a single record or a bulk array -- REST always wants an
    // array, so normalise rather than wrapping blindly (wrapping an array
    // would post one nested-garbage record).
    const data = Array.isArray(APIData) ? APIData : [APIData];
    return call(`/${Entity}`, {
      method: 'POST',
      body: JSON.stringify({ data, trigger: Trigger ?? [] }),
    });
  },

  async updateRecord({
    Entity, RecordID, APIData, Trigger,
  }: { Entity: string; RecordID: string; APIData: Json; Trigger?: string[] }) {
    return call(`/${Entity}/${RecordID}`, {
      method: 'PUT',
      body: JSON.stringify({ data: [APIData], trigger: Trigger ?? [] }),
    });
  },

  async deleteRecord({ Entity, RecordID }: { Entity: string; RecordID: string }) {
    return call(`/${Entity}/${RecordID}`, { method: 'DELETE' });
  },
};

export function installLiveZoho(): void {
  let onPageLoad: ((d: unknown) => void) | null = null;

  (globalThis as Record<string, unknown>).ZOHO = {
    embeddedApp: {
      on(_event: 'PageLoad', handler: (d: unknown) => void) { onPageLoad = handler; },
      async init() {
        // No CRM parent outside a frame, so answer the handshake ourselves.
        // A web tab's PageLoad carries no record context -- mirror that exactly.
        setTimeout(() => onPageLoad?.({}), 0);
      },
    },
    CRM: { API: api },
  };

  console.info('[live] ZOHO global installed -- calls go to the real CRM via /zoho proxy');
}
