// SQLite connection and schema bootstrap.
//
// Uses node:sqlite -- built into Node 22+, so there is no native module to
// compile. better-sqlite3 is the usual choice and has the same synchronous
// shape; swapping to it later touches only this file.
//
// The database is created from build/sqlite.sql on first run, so the schema is
// never hand-maintained: edit schema/model.yaml, regenerate, delete the file.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const DB_PATH = process.env.SQLITE_PATH ?? join(ROOT, 'data', 'school.db');
const SCHEMA_PATH = join(ROOT, 'build', 'sqlite.sql');

export function openDatabase() {
  const fresh = !existsSync(DB_PATH);
  mkdirSync(dirname(DB_PATH), { recursive: true });

  const db = new DatabaseSync(DB_PATH);

  // Off by default in SQLite, and every ON DELETE rule in the schema needs it.
  // Must be set per connection, not once at creation.
  db.exec('PRAGMA foreign_keys = ON;');
  // WAL lets reads proceed during a write, which matters as soon as the dev
  // server and a sqlite CLI are both attached.
  db.exec('PRAGMA journal_mode = WAL;');

  if (fresh) {
    if (!existsSync(SCHEMA_PATH)) {
      throw new Error(`missing ${SCHEMA_PATH} -- run: npm run gen:sqlite`);
    }
    db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
    console.log(`[db] created ${DB_PATH} from build/sqlite.sql`);
  } else {
    console.log(`[db] opened ${DB_PATH}`);
  }

  return db;
}
