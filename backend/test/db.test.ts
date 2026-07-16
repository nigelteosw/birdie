import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import { openDb } from '../src/db.js';

describe('db migration', () => {
  it('drops legacy role columns from an existing traces table', () => {
    const dir = mkdtempSync(join(tmpdir(), 'birdie-db-migration-'));
    const dbPath = join(dir, 'birdie.db');

    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE traces (
        id TEXT PRIMARY KEY,
        submitted_by TEXT NOT NULL,
        submitted_by_role TEXT NOT NULL,
        junior_name TEXT,
        senior_name TEXT,
        before_text TEXT NOT NULL,
        after_text TEXT NOT NULL,
        context_note TEXT,
        source TEXT NOT NULL DEFAULT 'manual',
        status TEXT NOT NULL DEFAULT 'captured',
        skip_reason TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `);
    legacy
      .prepare(
        `INSERT INTO traces (id, submitted_by, submitted_by_role, junior_name, senior_name, before_text, after_text)
         VALUES ('trace-1', 'Jane', 'junior', 'Jane', 'Sarah', 'before', 'after')`
      )
      .run();
    legacy.close();

    const db = openDb(dbPath);
    const columns = (db.prepare('PRAGMA table_info(traces)').all() as Array<{ name: string }>).map(
      (column) => column.name
    );
    expect(columns).not.toContain('submitted_by_role');
    expect(columns).not.toContain('junior_name');
    expect(columns).not.toContain('senior_name');
    expect(columns).toContain('submitted_by_user_id');

    db.prepare(
      `INSERT INTO traces (id, submitted_by, before_text, after_text) VALUES ('trace-2', 'Jane', 'before2', 'after2')`
    ).run();
    const row = db.prepare('SELECT * FROM traces WHERE id = ?').get('trace-2') as { submitted_by: string };
    expect(row.submitted_by).toBe('Jane');

    db.close();
  });

  it('creates a fresh traces table with no legacy role columns', () => {
    const db = openDb(':memory:');
    const columns = (db.prepare('PRAGMA table_info(traces)').all() as Array<{ name: string }>).map(
      (column) => column.name
    );
    expect(columns).not.toContain('submitted_by_role');
    expect(columns).not.toContain('junior_name');
    expect(columns).not.toContain('senior_name');
    expect(columns).toContain('submitted_by');
    expect(columns).toContain('submitted_by_user_id');
    const lessonColumns = (db.prepare('PRAGMA table_info(lessons)').all() as Array<{ name: string }>).map(
      (column) => column.name
    );
    expect(lessonColumns).toContain('reviewer_user_id');
    expect(lessonColumns).toContain('merged_into_lesson_id');
    db.close();
  });

  it('drops the legacy typology and playbook columns from an existing lessons table', () => {
    const dir = mkdtempSync(join(tmpdir(), 'birdie-db-migration-typology-'));
    const dbPath = join(dir, 'birdie.db');

    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE traces (
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
      CREATE TABLE lessons (
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
    `);
    legacy
      .prepare(
        `INSERT INTO traces (id, submitted_by, before_text, after_text, playbook_ref, playbook_text)
         VALUES ('trace-1', 'Jane', 'before', 'after', 'PB-1', 'Cite your sources.')`
      )
      .run();
    legacy
      .prepare(
        `INSERT INTO lessons (id, trace_id, quote, quote_verified, what_changed, why_it_matters, typology, playbook_alignment, playbook_note)
         VALUES ('lesson-1', 'trace-1', 'quote', 1, 'changed', 'why', 'other', 'diverges', 'Ignored the playbook rule.')`
      )
      .run();
    legacy.close();

    const db = openDb(dbPath);
    const traceColumns = (db.prepare('PRAGMA table_info(traces)').all() as Array<{ name: string }>).map(
      (column) => column.name
    );
    expect(traceColumns).not.toContain('playbook_ref');
    expect(traceColumns).not.toContain('playbook_text');
    const lessonColumns = (db.prepare('PRAGMA table_info(lessons)').all() as Array<{ name: string }>).map(
      (column) => column.name
    );
    expect(lessonColumns).not.toContain('typology');
    expect(lessonColumns).not.toContain('playbook_alignment');
    expect(lessonColumns).not.toContain('playbook_note');
    expect(traceColumns).toContain('submitted_by_user_id');
    expect(lessonColumns).toContain('reviewer_user_id');
    const row = db.prepare('SELECT * FROM lessons WHERE id = ?').get('lesson-1') as { quote: string };
    expect(row.quote).toBe('quote');
    db.close();
  });
});
