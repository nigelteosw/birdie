import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

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

function openDriver(dbPath: string): SqliteDb {
  return new Database(dbPath) as unknown as SqliteDb;
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
      submitted_by_user_id TEXT REFERENCES user(id),
      before_text TEXT NOT NULL,
      after_text TEXT NOT NULL,
      context_note TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      status TEXT NOT NULL DEFAULT 'captured',
      skip_reason TEXT,
      idempotency_key TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS lessons (
      id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL REFERENCES traces(id),
      quote TEXT NOT NULL,
      quote_verified INTEGER NOT NULL,
      what_changed TEXT NOT NULL,
      why_it_matters TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_review',
      reviewer TEXT,
      reviewer_user_id TEXT REFERENCES user(id),
      reviewed_at TEXT,
      promoted_at TEXT,
      merged_into_lesson_id TEXT REFERENCES lessons(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_traces_status ON traces(status);
    CREATE INDEX IF NOT EXISTS idx_lessons_status ON lessons(status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lessons_trace_id ON lessons(trace_id);
  `);
  dropColumnsIfPresent(db, 'traces', ['submitted_by_role', 'junior_name', 'senior_name', 'playbook_ref', 'playbook_text']);
  dropColumnsIfPresent(db, 'lessons', ['typology', 'playbook_alignment', 'playbook_note']);
  addColumnIfMissing(db, 'traces', 'submitted_by_user_id', 'TEXT REFERENCES user(id)');
  addColumnIfMissing(db, 'traces', 'idempotency_key', 'TEXT');
  addColumnIfMissing(db, 'lessons', 'reviewer_user_id', 'TEXT REFERENCES user(id)');
  addColumnIfMissing(db, 'lessons', 'merged_into_lesson_id', 'TEXT REFERENCES lessons(id)');
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_traces_idempotency_key ON traces(idempotency_key)
    WHERE idempotency_key IS NOT NULL;`);
  setUpLessonsFts(db);
}

function addColumnIfMissing(db: SqliteDb, table: string, column: string, definition: string): void {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!existing.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// Best-effort keyword search index. Not every SQLite build has FTS5 compiled
// in, so this degrades silently to the plain LIKE scan in lessonRepository
// rather than breaking setup on an unsupported build.
export function ftsAvailable(db: SqliteDb): boolean {
  const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'lessons_fts'`).all();
  return rows.length > 0;
}

function setUpLessonsFts(db: SqliteDb): void {
  try {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS lessons_fts USING fts5(id UNINDEXED, quote, what_changed, why_it_matters);`);
    db.exec(`
      INSERT INTO lessons_fts (id, quote, what_changed, why_it_matters)
      SELECT id, quote, what_changed, why_it_matters FROM lessons
      WHERE id NOT IN (SELECT id FROM lessons_fts);
    `);
  } catch {
    // FTS5 not available on this SQLite build — q filtering falls back to LIKE.
  }
}

// Best-effort schema cleanup. DROP COLUMN needs SQLite 3.35+; on an older
// build this silently leaves the column in place rather than crashing
// openDb() for every existing install.
function dropColumnsIfPresent(db: SqliteDb, table: string, columns: string[]): void {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  const names = new Set(existing.map((column) => column.name));
  for (const column of columns) {
    if (names.has(column)) {
      try {
        db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
      } catch {
        // DROP COLUMN unsupported on this SQLite build — leave the column in place.
      }
    }
  }
}
