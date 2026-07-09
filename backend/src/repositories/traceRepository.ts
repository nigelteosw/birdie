import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import type { NewTrace, Trace, TraceStatus } from '../types.js';

export class TraceRepository {
  constructor(private db: Database) {}

  create(input: NewTrace): Trace {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO traces (
          id, submitted_by, submitted_by_role, junior_name, senior_name,
          before_text, after_text, playbook_ref, playbook_text, context_note, source, status
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'captured'
        )`
      )
      .run(
        id,
        input.submitted_by,
        input.submitted_by_role,
        input.junior_name ?? null,
        input.senior_name ?? null,
        input.before_text,
        input.after_text,
        input.playbook_ref ?? null,
        input.playbook_text ?? null,
        input.context_note ?? null,
        input.source ?? 'manual'
      );
    return this.getById(id)!;
  }

  getById(id: string): Trace | undefined {
    return this.db.prepare('SELECT * FROM traces WHERE id = ?').get(id) as Trace | undefined;
  }

  list(status?: TraceStatus): Trace[] {
    if (status) {
      return this.db.prepare('SELECT * FROM traces WHERE status = ? ORDER BY created_at DESC').all(status) as Trace[];
    }
    return this.db.prepare('SELECT * FROM traces ORDER BY created_at DESC').all() as Trace[];
  }

  markExtracted(id: string): void {
    this.db.prepare("UPDATE traces SET status = 'extracted', skip_reason = NULL WHERE id = ?").run(id);
  }

  markSkipped(id: string, reason: string): void {
    this.db.prepare("UPDATE traces SET status = 'skipped', skip_reason = ? WHERE id = ?").run(reason, id);
  }
}
