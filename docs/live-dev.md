# Running the widgets against real CRM data

Hand-written. How to develop the two web tabs against the actual demo3 org
instead of the in-memory mock.

## The three ways to run

| | Transport | Data | Handshake | Needs |
|---|---|---|---|---|
| **Mock** (default) | in-memory arrays | fixtures | faked | nothing |
| **Live** | Zoho REST v8 via dev proxy | **real demo3** | faked | OAuth credentials |
| **`zet run`** | real SDK inside CRM | **real demo3** | **real** | widget registered in Zoho + a licence seat |

`zet run` is the shipping path and the only one that exercises the postMessage
handshake. Live mode is the day-to-day development path: real reads and real
writes, in an ordinary browser tab, with no licence seat consumed.

Mode is chosen automatically. Set the three credentials and the dev server
starts in live mode; leave any of them blank and it falls back to the mock. The
startup banner says which:

```
[zoho-proxy] live mode ON -> https://www.zohoapis.in
```

```
[zoho-proxy] ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN not set.
[zoho-proxy] Live mode is OFF -- the widgets will use the in-memory mock.
```

## Setting up live mode

**1. Create credentials.** In the Zoho API console for the demo3 org
(`https://api-console.zoho.<dc>`), create a **Self Client** or a **Server-based
Application** and generate a refresh token with these scopes:

```
ZohoCRM.modules.ALL,ZohoCRM.settings.modules.READ
```

**2. Fill in `.env`.** Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

```
ZOHO_CLIENT_ID=1000.xxxxxxxx
ZOHO_CLIENT_SECRET=xxxxxxxx
ZOHO_REFRESH_TOKEN=1000.xxxxxxxx
ZOHO_DC=in
```

`.env` is gitignored. Only `.env.example` is committed.

**3. Get the data centre right.** `ZOHO_DC` must match the org, or the token
refresh fails with `invalid_client`. demo3 is very likely `in` — its MCP
endpoints are `*.zohomcp.in`. Valid values: `com`, `in`, `eu`, `au`, `jp`, `ca`.

**4. Restart the dev server.** Credentials are read at startup, not per request.

## How it works

```
Browser                        Vite dev server                    Zoho
  fetch('/zoho/crm/v8/...')  ->  zohoProxy middleware  ->  zohoapis.<dc>
                                 + Authorization: Zoho-oauthtoken <access>
```

- **[src/zoho/live.ts](../src/zoho/live.ts)** installs a `ZOHO` global with the
  same shape as the mock, so `client.ts`, both tab apps and the generated
  `ZOHO_MODULES` map run completely unchanged. Only the transport differs.
- **[vite-zoho-proxy.ts](../vite-zoho-proxy.ts)** forwards `/zoho/*` to Zoho and
  attaches the OAuth header, refreshing the access token on demand (hourly,
  single-flight so concurrent calls don't each trigger a refresh).

Requests never go to `zohoapis.com` from the browser, for two reasons:

- **CORS.** Zoho sends no `Access-Control-Allow-Origin` for localhost, so a
  direct fetch is blocked before it leaves the browser.
- **Secrecy.** The refresh token and client secret stay in the Node process.
  Only a single boolean (`virtual:zoho-mode`'s `LIVE`) crosses into the bundle.

Both adapters sit behind `import.meta.env.DEV` **and** an unframed check, so
neither ships to production and neither can shadow the real SDK inside CRM.
Verified: `npm run build` emits no reference to `installLiveZoho`,
`installMockZoho`, `zoho-oauthtoken` or any credential.

## Seeding data

The same `.env` credentials let the seed script write to the CRM directly:

```bash
node scripts/seed-dummy.mjs --out seed/dummy-data.json   # build the file only
node scripts/seed-dummy.mjs --post                       # build and post to demo3
node scripts/seed-dummy.mjs --token <access-token>       # post with your own token
```

`--post` mints an access token from the refresh token automatically.

The dataset includes **300 class sessions**, expanded from each class's
`Meeting_Days` across its date range. Without them the Attendance Manager has
nothing to open — it reads `Class_Sessions` for a given date.

Posting is dependency-ordered, and sessions are chunked 100 at a time because
Zoho caps a create call at 100 records.

## Gotchas

**Writes are real.** In live mode the Attendance Manager writes actual
`Attendance` records to demo3. There is no undo. The mock exists precisely so
that experimenting costs nothing — prefer it unless you specifically need real
data.

**`204 No Content` is not an error.** Zoho answers "no matches" with 204 and an
empty body rather than `{"data":[]}`. `live.ts` converts it; a naive
`res.json()` would throw.

**The handshake is still faked.** Live mode proves the field mappings, the query
criteria and the write payloads against real data. It does **not** prove the
SDK handshake, widget registration, or the CSP/domain allowlist. Use `zet run`
before shipping. See [widget.md](widget.md).

**Empty timetable?** The Attendance Manager opens on today's date. Seeded terms
start 2026-10-05, so pick a date inside a term — or check that sessions were
actually posted.
