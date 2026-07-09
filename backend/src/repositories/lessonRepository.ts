import { randomUUID } from 'node:crypto';
import type { SqliteDb } from '../db.js';
import type { LessonEdit, LessonFilters, LessonWithTrace, NewExtraction, PromotePayload } from '../types.js';

interface LessonRow extends Omit<LessonWithTrace, 'quote_verified'> {
  quote_verified: number;
}

function rowToLesson(row: LessonRow): LessonWithTrace {
  return { ...row, quote_verified: row.quote_verified === 1 };
}

export class LessonRepository {
  constructor(private db: SqliteDb) {}

  create(input: NewExtraction & { quote_verified: boolean }): LessonWithTrace {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO lessons (
          id, trace_id, quote, quote_verified, what_changed, why_it_matters,
          typology, playbook_alignment, playbook_note, status
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review'
        )`
      )
      .run(
        id,
        input.trace_id,
        input.quote,
        input.quote_verified ? 1 : 0,
        input.what_changed,
        input.why_it_matters,
        input.typology,
        input.playbook_alignment ?? null,
        input.playbook_note ?? null
      );
    return this.getById(id)!;
  }

  getById(id: string): LessonWithTrace | undefined {
    const row = this.db.prepare(`${lessonSelect()} WHERE l.id = ?`).get(id) as LessonRow | undefined;
    return row ? rowToLesson(row) : undefined;
  }

  getByTraceId(traceId: string): LessonWithTrace | undefined {
    const row = this.db.prepare(`${lessonSelect()} WHERE l.trace_id = ?`).get(traceId) as LessonRow | undefined;
    return row ? rowToLesson(row) : undefined;
  }

  list(filters: LessonFilters): LessonWithTrace[] {
    const { where, params } = filterWhere(filters);
    const rows = this.db
      .prepare(`${lessonSelect()} ${where} ORDER BY l.created_at DESC`)
      .all(...params) as LessonRow[];
    return rows.map(rowToLesson);
  }

  edit(id: string, changes: LessonEdit & { quote_verified?: boolean }): LessonWithTrace {
    const current = this.getById(id);
    if (!current) throw new Error(`Lesson not found: ${id}`);
    const next = {
      quote: changes.quote ?? current.quote,
      quote_verified: changes.quote_verified ?? current.quote_verified,
      what_changed: changes.what_changed ?? current.what_changed,
      why_it_matters: changes.why_it_matters ?? current.why_it_matters,
      typology: changes.typology ?? current.typology,
      status: changes.reject ? 'rejected' : current.status,
    };
    this.db
      .prepare(
        `UPDATE lessons
         SET quote = ?, quote_verified = ?, what_changed = ?,
             why_it_matters = ?, typology = ?, status = ?,
             reviewed_at = CASE WHEN ? = 'rejected' THEN ? ELSE reviewed_at END
         WHERE id = ?`
      )
      .run(
        next.quote,
        next.quote_verified ? 1 : 0,
        next.what_changed,
        next.why_it_matters,
        next.typology,
        next.status,
        next.status,
        new Date().toISOString(),
        id
      );
    return this.getById(id)!;
  }

  promote(id: string, payload: PromotePayload & { quote_verified?: boolean }): LessonWithTrace {
    const current = this.getById(id);
    if (!current) throw new Error(`Lesson not found: ${id}`);
    if (current.status !== 'pending_review') {
      throw new Error(`Lesson ${id} cannot be promoted from status '${current.status}'`);
    }
    if (!payload.reviewer.trim()) {
      throw new Error('Reviewer is required');
    }
    const next = {
      quote: payload.quote ?? current.quote,
      quote_verified: payload.quote_verified ?? current.quote_verified,
      what_changed: payload.what_changed ?? current.what_changed,
      why_it_matters: payload.why_it_matters ?? current.why_it_matters,
      typology: payload.typology ?? current.typology,
    };
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE lessons
         SET quote = ?, quote_verified = ?, what_changed = ?,
             why_it_matters = ?, typology = ?, status = 'promoted',
             reviewer = ?, reviewed_at = ?, promoted_at = ?
         WHERE id = ?`
      )
      .run(
        next.quote,
        next.quote_verified ? 1 : 0,
        next.what_changed,
        next.why_it_matters,
        next.typology,
        payload.reviewer.trim(),
        now,
        now,
        id
      );
    return this.getById(id)!;
  }
}

function lessonSelect(): string {
  return `SELECT l.*, t.submitted_by, t.playbook_ref
          FROM lessons l
          JOIN traces t ON t.id = l.trace_id`;
}

function filterWhere(filters: LessonFilters): { where: string; params: string[] } {
  const clauses: string[] = [];
  const params: string[] = [];
  for (const key of ['status', 'typology', 'playbook_ref'] as const) {
    const value = filters[key];
    if (value) {
      clauses.push(key === 'status' || key === 'typology' ? `l.${key} = ?` : `t.${key} = ?`);
      params.push(value);
    }
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}
