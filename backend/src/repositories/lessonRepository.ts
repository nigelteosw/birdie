import { randomUUID } from 'node:crypto';
import { ftsAvailable, type SqliteDb } from '../db.js';
import type { LessonEdit, LessonFilters, LessonWithTrace, NewExtraction, PromotePayload } from '../types.js';

interface LessonRow extends Omit<LessonWithTrace, 'quote_verified'> {
  quote_verified: number;
}

function rowToLesson(row: LessonRow): LessonWithTrace {
  return { ...row, quote_verified: row.quote_verified === 1 };
}

export class LessonRepository {
  private readonly ftsAvailable: boolean;

  constructor(private db: SqliteDb) {
    this.ftsAvailable = ftsAvailable(db);
  }

  create(input: NewExtraction & { quote_verified: boolean }): LessonWithTrace {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO lessons (
          id, trace_id, quote, quote_verified, what_changed, why_it_matters, status
        ) VALUES (
          ?, ?, ?, ?, ?, ?, 'pending_review'
        )`
      )
      .run(
        id,
        input.trace_id,
        input.quote,
        input.quote_verified ? 1 : 0,
        input.what_changed,
        input.why_it_matters
      );
    this.syncFts(id, input.quote, input.what_changed, input.why_it_matters);
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

  getByIds(ids: string[], filters: Omit<LessonFilters, 'q' | 'limit'> = {}): LessonWithTrace[] {
    const lessons = ids
      .map((id) => this.getById(id))
      .filter((lesson): lesson is LessonWithTrace => lesson !== undefined);
    return lessons.filter((lesson) =>
      (!filters.status || lesson.status === filters.status) &&
      (!filters.submitted_by || lesson.submitted_by === filters.submitted_by) &&
      (!filters.submitted_by_user_id || lesson.submitted_by_user_id === filters.submitted_by_user_id)
    );
  }

  list(filters: LessonFilters): LessonWithTrace[] {
    const { where, params, usesFts } = filterWhere(filters, this.ftsAvailable);
    const limit = normalizeLimit(filters.limit);
    const rows = this.db
      .prepare(
        `${lessonSelect(usesFts)} ${where} ORDER BY ${usesFts ? 'bm25(lessons_fts), ' : ''}l.created_at DESC LIMIT ?`
      )
      .all(...params, limit) as LessonRow[];
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
      status: changes.reject ? 'rejected' : current.status,
    };
    this.db
      .prepare(
        `UPDATE lessons
         SET quote = ?, quote_verified = ?, what_changed = ?,
             why_it_matters = ?, status = ?,
             reviewed_at = CASE WHEN ? = 'rejected' THEN ? ELSE reviewed_at END
         WHERE id = ?`
      )
      .run(
        next.quote,
        next.quote_verified ? 1 : 0,
        next.what_changed,
        next.why_it_matters,
        next.status,
        next.status,
        new Date().toISOString(),
        id
      );
    this.syncFts(id, next.quote, next.what_changed, next.why_it_matters);
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
    };
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE lessons
         SET quote = ?, quote_verified = ?, what_changed = ?,
             why_it_matters = ?, status = 'promoted',
             reviewer = ?, reviewer_user_id = ?, reviewed_at = ?, promoted_at = ?
         WHERE id = ?`
      )
      .run(
        next.quote,
        next.quote_verified ? 1 : 0,
        next.what_changed,
        next.why_it_matters,
        payload.reviewer.trim(),
        payload.reviewer_user_id ?? null,
        now,
        now,
        id
      );
    this.syncFts(id, next.quote, next.what_changed, next.why_it_matters);
    return this.getById(id)!;
  }

  delete(id: string): void {
    const current = this.getById(id);
    if (!current) throw new Error(`Lesson not found: ${id}`);
    if (current.status !== 'promoted') {
      throw new Error(`Lesson ${id} cannot be deleted from status '${current.status}'`);
    }
    this.db.prepare('DELETE FROM lessons WHERE id = ?').run(id);
    this.deleteFts(id);
  }

  private deleteFts(id: string): void {
    if (!this.ftsAvailable) return;
    this.db.prepare('DELETE FROM lessons_fts WHERE id = ?').run(id);
  }

  private syncFts(id: string, quote: string, whatChanged: string, whyItMatters: string): void {
    if (!this.ftsAvailable) return;
    this.deleteFts(id);
    this.db
      .prepare('INSERT INTO lessons_fts (id, quote, what_changed, why_it_matters) VALUES (?, ?, ?, ?)')
      .run(id, quote, whatChanged, whyItMatters);
  }
}

function lessonSelect(usesFts = false): string {
  return `SELECT l.*, t.submitted_by, t.submitted_by_user_id
          FROM lessons l
          JOIN traces t ON t.id = l.trace_id
          ${usesFts ? 'JOIN lessons_fts ON lessons_fts.id = l.id' : ''}`;
}

function filterWhere(filters: LessonFilters, ftsAvailable: boolean): { where: string; params: string[]; usesFts: boolean } {
  const clauses: string[] = [];
  const params: string[] = [];
  let usesFts = false;
  for (const key of ['status', 'submitted_by', 'submitted_by_user_id'] as const) {
    const value = filters[key];
    if (value) {
      clauses.push(key === 'status' ? `l.${key} = ?` : `t.${key} = ?`);
      params.push(value);
    }
  }
  if (filters.q) {
    const keywords = filters.q
      .toLowerCase()
      .split(/\W+/)
      .filter(Boolean);
    if (keywords.length > 0) {
      if (ftsAvailable) {
        // FTS5 tokenizes on word boundaries, so quoting each keyword treats it
        // as a literal token and sidesteps MATCH's query-syntax operators
        // (e.g. a keyword containing "-" or ":" would otherwise be parsed as
        // a column filter or NOT clause instead of matched literally).
        const match = keywords.map((keyword) => `"${keyword.replace(/"/g, '""')}"`).join(' OR ');
        clauses.push('lessons_fts MATCH ?');
        params.push(match);
        usesFts = true;
      } else {
        clauses.push(
          `(${keywords
            .map((keyword) => {
              const value = `%${keyword}%`;
              params.push(value, value, value);
              return `(lower(l.quote) LIKE ? OR lower(l.what_changed) LIKE ? OR lower(l.why_it_matters) LIKE ?)`;
            })
            .join(' OR ')})`
        );
      }
    }
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params, usesFts };
}

function normalizeLimit(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return 100;
  return Math.min(Math.max(Math.floor(value), 1), 100);
}
