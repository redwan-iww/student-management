// Syntax-checks build/postgres.sql against the real PostgreSQL grammar
// (libpg_query via pgsql-parser). This catches malformed DDL without needing a
// running server; it does NOT check that types, FK targets or columns resolve.
// For that, run the file against a scratch database -- see docs/verification.md.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './lib/model.mjs';

const file = join(paths.build, 'postgres.sql');
const mod = await import('pgsql-parser');
const parse = mod.parse ?? mod.default?.parse ?? mod.parseSync;

try {
  const result = await parse(readFileSync(file, 'utf8'));
  const stmts = result.stmts ?? result;
  console.log(`OK  ${file}  (${Array.isArray(stmts) ? stmts.length : '?'} statements parsed)`);
} catch (err) {
  console.error(`FAIL ${file}`);
  console.error(err.message);
  process.exit(1);
}
