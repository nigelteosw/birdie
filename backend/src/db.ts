import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(dbPath: string): Database {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  migrate(db);
  return db;
}

function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS traces (
      id TEXT PRIMARY KEY,
      submitted_by TEXT NOT NULL,
      submitted_by_role TEXT NOT NULL,
      junior_name TEXT,
      senior_name TEXT,
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
}
