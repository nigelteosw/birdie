import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface SqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqliteDb {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
}

const require = createRequire(import.meta.url);

// Bun ships its own faster `bun:sqlite`; the plugin binary run by end users
// is plain Node, which only has `node:sqlite`. Pick whichever the current
// runtime provides rather than forcing Node's driver on Bun (unsupported)
// or vice versa.
function openDriver(dbPath: string): SqliteDb {
  if (typeof Bun !== 'undefined') {
    const { Database } = require('bun:sqlite') as typeof import('bun:sqlite');
    return new Database(dbPath) as unknown as SqliteDb;
  }
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  return new DatabaseSync(dbPath) as unknown as SqliteDb;
}

export function openDb(dbPath: string): SqliteDb {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = openDriver(dbPath);
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  migrate(db);
  return db;
}

function migrate(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS traces (
      id TEXT PRIMARY KEY,
      submitted_by TEXT NOT NULL,
      before_text TEXT NOT NULL,
      after_text TEXT NOT NULL,
      playbook_ref TEXT,
      playbook_text TEXT,
      context_note TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      status TEXT NOT NULL DEFAULT 'captured',
      skip_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS lessons (
      id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL REFERENCES traces(id),
      quote TEXT NOT NULL,
      quote_verified INTEGER NOT NULL,
      what_changed TEXT NOT NULL,
      why_it_matters TEXT NOT NULL,
      typology TEXT NOT NULL,
      playbook_alignment TEXT,
      playbook_note TEXT,
      status TEXT NOT NULL DEFAULT 'pending_review',
      reviewer TEXT,
      reviewed_at TEXT,
      promoted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_traces_status ON traces(status);
    CREATE INDEX IF NOT EXISTS idx_lessons_status ON lessons(status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lessons_trace_id ON lessons(trace_id);
  `);
  dropLegacyRoleColumns(db);
}

function dropLegacyRoleColumns(db: SqliteDb): void {
  const columns = db.prepare('PRAGMA table_info(traces)').all() as Array<{ name: string }>;
  const names = new Set(columns.map((column) => column.name));
  for (const column of ['submitted_by_role', 'junior_name', 'senior_name']) {
    if (names.has(column)) {
      db.exec(`ALTER TABLE traces DROP COLUMN ${column}`);
    }
  }
}
