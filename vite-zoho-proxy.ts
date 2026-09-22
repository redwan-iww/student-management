// Dev-server proxy that lets the widgets talk to the real CRM.
//
// Browser                     Vite dev server                  Zoho
//   fetch('/zoho/crm/v8/...')  ->  this middleware  ->  https://www.zohoapis.<dc>
//                                  + Authorization: Zoho-oauthtoken <access>
//
// Why a middleware rather than `server.proxy`: the Authorization header has to
// be computed asynchronously (the access token expires hourly and is refreshed
// on demand), and http-proxy's `proxyReq` hook is synchronous. Doing the fetch
// here keeps the refresh await-able.
//
// The refresh token and client secret stay in this Node process. They are never
// exposed to the browser bundle -- which is the other half of why the widget
// cannot simply call zohoapis.com itself (the first half being CORS).

import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface ZohoProxyOptions {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  /** Zoho data centre: com | in | eu | au | jp | ca. */
  dc?: string;
}

const PREFIX = '/zoho';

/** Virtual module the entries import to learn which transport to install. */
export const VIRTUAL_ID = 'virtual:zoho-mode';

/** Access tokens last an hour; refresh a minute early to avoid a race. */
const EXPIRY_SKEW_MS = 60_000;

export function zohoProxy(opts: ZohoProxyOptions): Plugin {
  const dc = opts.dc || 'com';
  const apiHost = `https://www.zohoapis.${dc}`;
  const accountsHost = `https://accounts.zoho.${dc}`;

  const configured = Boolean(opts.clientId && opts.clientSecret && opts.refreshToken);

  let accessToken: string | null = null;
  let expiresAt = 0;
  let inFlight: Promise<string> | null = null;

  async function refresh(): Promise<string> {
    const body = new URLSearchParams({
      refresh_token: opts.refreshToken!,
      client_id: opts.clientId!,
      client_secret: opts.clientSecret!,
      grant_type: 'refresh_token',
    });
    const res = await fetch(`${accountsHost}/oauth/v2/token`, { method: 'POST', body });
    const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };

    if (!json.access_token) {
      throw new Error(
        `token refresh failed: ${json.error ?? res.status}. ` +
          `If this says "invalid_client" or "invalid_code", the credentials are for a ` +
          `different data centre -- set ZOHO_DC (currently "${dc}").`,
      );
    }
    accessToken = json.access_token;
    expiresAt = Date.now() + (json.expires_in ?? 3600) * 1000;
    console.info(`[zoho-proxy] access token refreshed, valid ~${Math.round((json.expires_in ?? 3600) / 60)}m`);
    return accessToken;
  }

  /** Single-flight: concurrent widget calls must not each trigger a refresh. */
  function token(): Promise<string> {
    if (accessToken && Date.now() < expiresAt - EXPIRY_SKEW_MS) return Promise.resolve(accessToken);
    inFlight ??= refresh().finally(() => { inFlight = null; });
    return inFlight;
  }

  function fail(res: ServerResponse, status: number, code: string, message: string) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ code, message, status: 'error' }));
  }

  return {
    name: 'zoho-proxy',

    // The plugin already knows whether credentials are present, so it -- not
    // vite.config's `define` -- is the single source of truth. A virtual module
    // is used rather than `define`, because a bare `__FLAG__` identifier is not
    // substituted by the dev transform (it reaches the browser and throws
    // ReferenceError) and `import.meta.env.VITE_*` set from config is not
    // reliably exposed either. A virtual module resolves identically in dev and
    // in build.
    resolveId(id) {
      if (id === VIRTUAL_ID) return `\0${VIRTUAL_ID}`;
      return null;
    },
    load(id) {
      if (id === `\0${VIRTUAL_ID}`) return `export const LIVE = ${configured};\n`;
      return null;
    },

    configureServer(server) {
      if (!configured) {
        console.warn(
          '\n[zoho-proxy] ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN not set.' +
            '\n[zoho-proxy] Live mode is OFF -- the widgets will use the in-memory mock.' +
            '\n[zoho-proxy] See docs/live-dev.md to switch to real CRM data.\n',
        );
        return;
      }
      console.info(`\n[zoho-proxy] live mode ON -> ${apiHost}\n`);

      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        if (!req.url?.startsWith(`${PREFIX}/`)) return next();

        const target = `${apiHost}${req.url.slice(PREFIX.length)}`;
        try {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const payload = Buffer.concat(chunks);

          const upstream = await fetch(target, {
            method: req.method,
            headers: {
              Authorization: `Zoho-oauthtoken ${await token()}`,
              'Content-Type': 'application/json',
            },
            body: payload.length ? payload : undefined,
          });

          // 204 has no body and no content-type; forward the status as-is so
          // live.ts can turn it into an empty result set.
          res.statusCode = upstream.status;
          const ct = upstream.headers.get('content-type');
          if (ct) res.setHeader('Content-Type', ct);
          const text = await upstream.text();
          console.info(`[zoho-proxy] ${req.method} ${req.url} -> ${upstream.status}`);
          res.end(text);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[zoho-proxy] ${req.method} ${req.url} FAILED: ${message}`);
          fail(res, 502, 'PROXY_ERROR', message);
        }
      });
    },
  };
}
