// Local API server: Express + SQLite, standing in for Supabase during
// development.
//
//   npm run server        -> http://localhost:3001/api
//
// The route shape copies PostgREST (what Supabase exposes), so the browser
// client written against this also speaks to Supabase later.

import express from 'express';
import { openDatabase, DB_PATH } from './db.mjs';
import { createApi } from './api.mjs';

const PORT = Number(process.env.API_PORT ?? 3001);

const db = openDatabase();
const app = express();

app.use(express.json({ limit: '4mb' }));

// The Vite dev server proxies /api, so same-origin in dev. This is here for
// the case where the app is served from somewhere else entirely.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN ?? '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.get('/api/health', (_req, res) => res.json({ ok: true, db: DB_PATH }));
app.use('/api', createApi(db));

app.listen(PORT, () => {
  console.log(`[api] listening on http://localhost:${PORT}/api`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    db.close();
    process.exit(0);
  });
}
