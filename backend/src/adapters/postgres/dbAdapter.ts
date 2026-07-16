import { randomUUID } from 'node:crypto';
import type { BetterAuthOptions } from 'better-auth';
import { PostgresDialect } from 'kysely';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import pgvector from 'pgvector';
import type {
  DBAdapter,
  DBSession,
  LessonStore,
  TraceStore,
  UserAdminStore,
} from '../types.js';
import type {
  LessonEdit,
  LessonFilters,
  LessonStatus,
  LessonWithTrace,
  MergeLessonPayload,
  NewExtraction,
  NewTrace,
  PromotePayload,
  Trace,
  TraceStatus,
} from '../../types.js';
import {
  HASHED_TRIGRAM_DIMENSIONS,
  HASHED_TRIGRAM_VECTORIZER_ID,
  hashedTrigramVector,
} from './hashedTrigramVectorizer.js';

interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
}

interface TraceRow extends Omit<Trace, 'created_at'> {
  created_at: Date | string;
}

interface LessonRow extends Omit<LessonWithTrace, 'created_at' | 'reviewed_at' | 'promoted_at'> {
  created_at: Date | string;
  reviewed_at: Date | string | null;
  promoted_at: Date | string | null;
}

export interface PostgresDBAdapterOptions {
  connectionString: string;
  schema?: string;
}

class PostgresTraceStore implements TraceStore {
  constructor(private readonly db: Queryable) {}

  async create(input: NewTrace): Promise<Trace> {
    const result = await this.db.query<TraceRow>(
      `INSERT INTO traces (
         id, submitted_by, submitted_by_user_id, before_text, after_text, context_note, source, idempotency_key, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'captured')
       RETURNING *`,
      [
        randomUUID(),
        input.submitted_by,
        input.submitted_by_user_id ?? null,
        input.before_text,
        input.after_text,
        input.context_note ?? null,
        input.source ?? 'manual',
        input.idempotency_key ?? null,
      ]
    );
    return rowToTrace(result.rows[0]);
  }

  async getById(id: string): Promise<Trace | undefined> {
    const result = await this.db.query<TraceRow>('SELECT * FROM traces WHERE id = $1', [id]);
    return result.rows[0] ? rowToTrace(result.rows[0]) : undefined;
  }

  async getByIdempotencyKey(key: string): Promise<Trace | undefined> {
    const result = await this.db.query<TraceRow>('SELECT * FROM traces WHERE idempotency_key = $1', [key]);
    return result.rows[0] ? rowToTrace(result.rows[0]) : undefined;
  }

  async list(status?: TraceStatus): Promise<Trace[]> {
    const result = status
      ? await this.db.query<TraceRow>('SELECT * FROM traces WHERE status = $1 ORDER BY created_at DESC', [status])
      : await this.db.query<TraceRow>('SELECT * FROM traces ORDER BY created_at DESC');
    return result.rows.map(rowToTrace);
  }

  async markExtracted(id: string): Promise<void> {
    await this.db.query("UPDATE traces SET status = 'extracted', skip_reason = NULL WHERE id = $1", [id]);
  }

  async markSkipped(id: string, reason: string): Promise<void> {
    await this.db.query("UPDATE traces SET status = 'skipped', skip_reason = $1 WHERE id = $2", [reason, id]);
  }
}

class PostgresLessonStore implements LessonStore {
  constructor(private readonly db: Queryable) {}

  async create(input: NewExtraction & { quote_verified: boolean }): Promise<LessonWithTrace> {
    const id = randomUUID();
    await this.db.query(
      `INSERT INTO lessons (
         id, trace_id, quote, quote_verified, what_changed, why_it_matters, status
       ) VALUES ($1, $2, $3, $4, $5, $6, 'pending_review')`,
      [id, input.trace_id, input.quote, input.quote_verified, input.what_changed, input.why_it_matters]
    );
    const lesson = await this.require(id);
    await this.syncSearch(lesson);
    return lesson;
  }

  async getById(id: string): Promise<LessonWithTrace | undefined> {
    const result = await this.db.query<LessonRow>(`${lessonSelect()} WHERE l.id = $1`, [id]);
    return result.rows[0] ? rowToLesson(result.rows[0]) : undefined;
  }

  async getByTraceId(traceId: string): Promise<LessonWithTrace | undefined> {
    const result = await this.db.query<LessonRow>(`${lessonSelect()} WHERE l.trace_id = $1`, [traceId]);
    return result.rows[0] ? rowToLesson(result.rows[0]) : undefined;
  }

  async getByIds(
    ids: string[],
    filters: Omit<LessonFilters, 'q' | 'limit'> = {}
  ): Promise<LessonWithTrace[]> {
    if (ids.length === 0) return [];
    const params: unknown[] = [ids];
    const clauses = ['l.id = ANY($1::text[])'];
    addLessonFilters(clauses, params, filters);
    const result = await this.db.query<LessonRow>(`${lessonSelect()} WHERE ${clauses.join(' AND ')}`, params);
    const byId = new Map(result.rows.map((row) => [row.id, rowToLesson(row)]));
    return ids.map((id) => byId.get(id)).filter((lesson): lesson is LessonWithTrace => lesson !== undefined);
  }

  async list(filters: LessonFilters): Promise<LessonWithTrace[]> {
    const params: unknown[] = [];
    const clauses: string[] = [];
    let join = '';
    let order = 'l.created_at DESC';
    const query = filters.q?.normalize('NFKC').trim();
    if (query) {
      params.push(pgvector.toSql(hashedTrigramVector(query)));
      const vectorParam = `$${params.length}`;
      params.push(HASHED_TRIGRAM_VECTORIZER_ID);
      const vectorizerParam = `$${params.length}`;
      join = 'JOIN lesson_search_vectors s ON s.lesson_id = l.id';
      clauses.push(`s.vectorizer_id = ${vectorizerParam}`);
      order = `s.embedding <=> ${vectorParam}::vector, l.promoted_at DESC NULLS LAST`;
    }
    addLessonFilters(clauses, params, filters);
    params.push(normalizeLimit(filters.limit));
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const result = await this.db.query<LessonRow>(
      `${lessonSelect(join)} ${where} ORDER BY ${order} LIMIT $${params.length}`,
      params
    );
    return result.rows.map(rowToLesson);
  }

  async edit(id: string, changes: LessonEdit & { quote_verified?: boolean }): Promise<LessonWithTrace> {
    const current = await this.require(id);
    const nextStatus: LessonStatus = changes.reject ? 'rejected' : current.status;
    const now = new Date().toISOString();
    await this.db.query(
      `UPDATE lessons
       SET quote = $1, quote_verified = $2, what_changed = $3, why_it_matters = $4, status = $5,
           reviewed_at = CASE WHEN $5 = 'rejected' THEN $6 ELSE reviewed_at END
       WHERE id = $7`,
      [
        changes.quote ?? current.quote,
        changes.quote_verified ?? current.quote_verified,
        changes.what_changed ?? current.what_changed,
        changes.why_it_matters ?? current.why_it_matters,
        nextStatus,
        now,
        id,
      ]
    );
    const updated = await this.require(id);
    await this.syncSearch(updated);
    return updated;
  }

  async promote(id: string, payload: PromotePayload & { quote_verified?: boolean }): Promise<LessonWithTrace> {
    const current = await this.require(id);
    if (current.status !== 'pending_review') {
      throw new Error(`Lesson ${id} cannot be promoted from status '${current.status}'`);
    }
    if (!payload.reviewer.trim()) throw new Error('Reviewer is required');
    const now = new Date().toISOString();
    await this.db.query(
      `UPDATE lessons
       SET quote = $1, quote_verified = $2, what_changed = $3, why_it_matters = $4,
           status = 'promoted', reviewer = $5, reviewer_user_id = $6, reviewed_at = $7, promoted_at = $7
       WHERE id = $8`,
      [
        payload.quote ?? current.quote,
        payload.quote_verified ?? current.quote_verified,
        payload.what_changed ?? current.what_changed,
        payload.why_it_matters ?? current.why_it_matters,
        payload.reviewer.trim(),
        payload.reviewer_user_id ?? null,
        now,
        id,
      ]
    );
    const promoted = await this.require(id);
    await this.syncSearch(promoted);
    return promoted;
  }

  async merge(sourceId: string, targetId: string, payload: MergeLessonPayload): Promise<LessonWithTrace> {
    const source = await this.require(sourceId);
    const target = await this.require(targetId);
    if (sourceId === targetId) throw new Error('A lesson cannot be merged into itself');
    if (source.status !== 'pending_review') throw new Error('Only pending lessons can be merged');
    if (target.status === 'rejected') throw new Error('Cannot merge into rejected guidance');
    if (!payload.reviewer.trim()) throw new Error('Reviewer is required');
    await this.db.query(
      `UPDATE lessons
       SET status = 'rejected', merged_into_lesson_id = $1, reviewer = $2,
           reviewer_user_id = $3, reviewed_at = $4
       WHERE id = $5`,
      [targetId, payload.reviewer.trim(), payload.reviewer_user_id ?? null, new Date().toISOString(), sourceId]
    );
    await this.db.query('DELETE FROM lesson_search_vectors WHERE lesson_id = $1', [sourceId]);
    return this.require(sourceId);
  }

  async delete(id: string): Promise<void> {
    const current = await this.require(id);
    if (current.status !== 'promoted') {
      throw new Error(`Lesson ${id} cannot be deleted from status '${current.status}'`);
    }
    await this.db.query('UPDATE lessons SET merged_into_lesson_id = NULL WHERE merged_into_lesson_id = $1', [id]);
    await this.db.query('DELETE FROM lessons WHERE id = $1', [id]);
  }

  async *streamPromoted(): AsyncIterable<LessonWithTrace> {
    const result = await this.db.query<LessonRow>(
      `${lessonSelect()} WHERE l.status = 'promoted' ORDER BY l.created_at ASC`
    );
    for (const row of result.rows) yield rowToLesson(row);
  }

  private async require(id: string): Promise<LessonWithTrace> {
    const lesson = await this.getById(id);
    if (!lesson) throw new Error(`Lesson not found: ${id}`);
    return lesson;
  }

  private async syncSearch(lesson: LessonWithTrace): Promise<void> {
    const document = [lesson.quote, lesson.quote, lesson.what_changed, lesson.why_it_matters].join('\n');
    const embedding = pgvector.toSql(hashedTrigramVector(document));
    await this.db.query(
      `INSERT INTO lesson_search_vectors (
         lesson_id, status, submitted_by, submitted_by_user_id, vectorizer_id, embedding, promoted_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (lesson_id) DO UPDATE SET
         status = EXCLUDED.status,
         submitted_by = EXCLUDED.submitted_by,
         submitted_by_user_id = EXCLUDED.submitted_by_user_id,
         vectorizer_id = EXCLUDED.vectorizer_id,
         embedding = EXCLUDED.embedding,
         promoted_at = EXCLUDED.promoted_at`,
      [
        lesson.id,
        lesson.status,
        lesson.submitted_by,
        lesson.submitted_by_user_id,
        HASHED_TRIGRAM_VECTORIZER_ID,
        embedding,
        lesson.promoted_at,
      ]
    );
  }
}

class PostgresUserAdminStore implements UserAdminStore {
  constructor(private readonly db: Queryable) {}

  async findByEmail(email: string) {
    const result = await this.db.query<{ id: string; email: string; name: string; role: string | null }>(
      'SELECT id, email, name, role FROM "user" WHERE lower(email) = lower($1)',
      [email]
    );
    return result.rows[0];
  }

  async findById(id: string) {
    const result = await this.db.query<{
      id: string;
      email: string;
      name: string;
      role: string | null;
      banned: boolean | null;
    }>('SELECT id, email, name, role, banned FROM "user" WHERE id = $1', [id]);
    return result.rows[0];
  }

  async setRole(userId: string, role: 'admin') {
    const result = await this.db.query<{ id: string; email: string; name: string; role: string | null }>(
      `UPDATE "user" SET role = $1, "updatedAt" = $2 WHERE id = $3 RETURNING id, email, name, role`,
      [role, new Date().toISOString(), userId]
    );
    if (!result.rows[0]) throw new Error('Bootstrapped admin user disappeared during role update.');
    return result.rows[0];
  }

  async isEnabledAdmin(userId: string): Promise<boolean> {
    const result = await this.db.query<{ role: string | null; banned: boolean | null }>(
      'SELECT role, banned FROM "user" WHERE id = $1',
      [userId]
    );
    const user = result.rows[0];
    return Boolean(user && user.banned !== true && String(user.role ?? '').split(',').includes('admin'));
  }

  async countEnabledAdmins(): Promise<number> {
    const result = await this.db.query<{ role: string | null }>(
      'SELECT role FROM "user" WHERE banned IS NULL OR banned = false'
    );
    return result.rows.filter((user) => String(user.role ?? '').split(',').includes('admin')).length;
  }
}

export class PostgresDBAdapter implements DBAdapter {
  readonly authDatabase: NonNullable<BetterAuthOptions['database']>;
  readonly traces: TraceStore;
  readonly lessons: LessonStore;
  readonly users: UserAdminStore;
  private readonly pool: Pool;
  private closed = false;

  constructor(options: PostgresDBAdapterOptions) {
    const schema = options.schema ?? 'public';
    if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('PostgreSQL schema name is invalid.');
    this.pool = new Pool({
      connectionString: options.connectionString,
      options: `-c search_path=${schema},public`,
    });
    this.authDatabase = new PostgresDialect({ pool: this.pool }) as NonNullable<BetterAuthOptions['database']>;
    const session = createSession(this.pool);
    this.traces = session.traces;
    this.lessons = session.lessons;
    this.users = session.users;
  }

  async initialize(): Promise<void> {
    try {
      await this.pool.query('CREATE EXTENSION IF NOT EXISTS vector');
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS traces (
          id text PRIMARY KEY,
          submitted_by text NOT NULL,
          submitted_by_user_id text,
          before_text text NOT NULL,
          after_text text NOT NULL,
          context_note text,
          source text NOT NULL DEFAULT 'manual',
          status text NOT NULL DEFAULT 'captured',
          skip_reason text,
          idempotency_key text,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS lessons (
          id text PRIMARY KEY,
          trace_id text NOT NULL UNIQUE REFERENCES traces(id),
          quote text NOT NULL,
          quote_verified boolean NOT NULL,
          what_changed text NOT NULL,
          why_it_matters text NOT NULL,
          status text NOT NULL DEFAULT 'pending_review',
          reviewer text,
          reviewer_user_id text,
          reviewed_at timestamptz,
          promoted_at timestamptz,
          merged_into_lesson_id text REFERENCES lessons(id),
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS lesson_search_vectors (
          lesson_id text PRIMARY KEY REFERENCES lessons(id) ON DELETE CASCADE,
          status text NOT NULL,
          submitted_by text NOT NULL,
          submitted_by_user_id text,
          vectorizer_id text NOT NULL,
          embedding vector(${HASHED_TRIGRAM_DIMENSIONS}) NOT NULL,
          promoted_at timestamptz
        );
        ALTER TABLE lesson_search_vectors ALTER COLUMN promoted_at DROP NOT NULL;
        ALTER TABLE lessons
          ADD COLUMN IF NOT EXISTS merged_into_lesson_id text REFERENCES lessons(id);
        ALTER TABLE traces
          ADD COLUMN IF NOT EXISTS idempotency_key text;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_traces_idempotency_key
          ON traces(idempotency_key) WHERE idempotency_key IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_traces_status ON traces(status);
        CREATE INDEX IF NOT EXISTS idx_lessons_status ON lessons(status);
        CREATE INDEX IF NOT EXISTS idx_lesson_search_embedding
          ON lesson_search_vectors USING hnsw (embedding vector_cosine_ops);
      `);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/vector|extension/i.test(message)) {
        throw new Error(`PostgreSQL pgvector initialization failed: ${message}`);
      }
      throw error;
    }
  }

  async transaction<T>(work: (session: DBSession) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(createSession(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.pool.end();
  }
}

function createSession(db: Queryable | PoolClient): DBSession {
  return {
    traces: new PostgresTraceStore(db),
    lessons: new PostgresLessonStore(db),
    users: new PostgresUserAdminStore(db),
  };
}

function lessonSelect(join = ''): string {
  return `SELECT l.*, t.submitted_by, t.submitted_by_user_id
          FROM lessons l
          JOIN traces t ON t.id = l.trace_id
          ${join}`;
}

function addLessonFilters(
  clauses: string[],
  params: unknown[],
  filters: Omit<LessonFilters, 'q' | 'limit'>
): void {
  if (filters.status) {
    params.push(filters.status);
    clauses.push(`l.status = $${params.length}`);
  }
  if (filters.submitted_by) {
    params.push(filters.submitted_by);
    clauses.push(`t.submitted_by = $${params.length}`);
  }
  if (filters.submitted_by_user_id) {
    params.push(filters.submitted_by_user_id);
    clauses.push(`t.submitted_by_user_id = $${params.length}`);
  }
}

function normalizeLimit(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return 100;
  return Math.min(Math.max(Math.floor(value), 1), 100);
}

function rowToTrace(row: TraceRow): Trace {
  return { ...row, created_at: toIso(row.created_at)! };
}

function rowToLesson(row: LessonRow): LessonWithTrace {
  return {
    ...row,
    created_at: toIso(row.created_at)!,
    reviewed_at: toIso(row.reviewed_at),
    promoted_at: toIso(row.promoted_at),
  };
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}
