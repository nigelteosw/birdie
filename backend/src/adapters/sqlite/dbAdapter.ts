import type { BetterAuthOptions } from 'better-auth';
import { openDb, type SqliteDb } from '../../db.js';
import { LessonRepository } from '../../repositories/lessonRepository.js';
import { TraceRepository } from '../../repositories/traceRepository.js';
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
  LessonWithTrace,
  MergeLessonPayload,
  NewExtraction,
  NewTrace,
  PromotePayload,
  TraceStatus,
} from '../../types.js';

class SQLiteTraceStore implements TraceStore {
  constructor(private readonly repository: TraceRepository) {}

  async create(input: NewTrace) { return this.repository.create(input); }
  async getById(id: string) { return this.repository.getById(id); }
  async list(status?: TraceStatus) { return this.repository.list(status); }
  async markExtracted(id: string) { this.repository.markExtracted(id); }
  async markSkipped(id: string, reason: string) { this.repository.markSkipped(id, reason); }
}

class SQLiteLessonStore implements LessonStore {
  constructor(private readonly repository: LessonRepository) {}

  async create(input: NewExtraction & { quote_verified: boolean }) { return this.repository.create(input); }
  async getById(id: string) { return this.repository.getById(id); }
  async getByTraceId(traceId: string) { return this.repository.getByTraceId(traceId); }
  async getByIds(ids: string[], filters: Omit<LessonFilters, 'q' | 'limit'> = {}) {
    return this.repository.getByIds(ids, filters);
  }
  async list(filters: LessonFilters) { return this.repository.list(filters); }
  async edit(id: string, changes: LessonEdit & { quote_verified?: boolean }) {
    return this.repository.edit(id, changes);
  }
  async promote(id: string, payload: PromotePayload & { quote_verified?: boolean }) {
    return this.repository.promote(id, payload);
  }
  async merge(sourceId: string, targetId: string, payload: MergeLessonPayload) {
    return this.repository.merge(sourceId, targetId, payload);
  }
  async delete(id: string) { this.repository.delete(id); }
  async *streamPromoted(): AsyncIterable<LessonWithTrace> {
    for (const lesson of this.repository.list({ status: 'promoted', limit: 100 })) yield lesson;
  }
}

class SQLiteUserAdminStore implements UserAdminStore {
  constructor(private readonly db: SqliteDb) {}

  async findByEmail(email: string) {
    return this.db.prepare('SELECT id, email, name, role FROM user WHERE lower(email) = lower(?)').get(email) as
      | { id: string; email: string; name: string; role?: string | null }
      | undefined;
  }

  async findById(id: string) {
    return this.db.prepare('SELECT id, email, name, role, banned FROM user WHERE id = ?').get(id) as
      | { id: string; email: string; name: string; role?: string | null; banned: number | boolean | null }
      | undefined;
  }

  async setRole(userId: string, role: 'admin') {
    this.db.prepare('UPDATE user SET role = ?, updatedAt = ? WHERE id = ?').run(role, new Date().toISOString(), userId);
    const user = this.db.prepare('SELECT id, email, name, role FROM user WHERE id = ?').get(userId) as
      | { id: string; email: string; name: string; role?: string | null }
      | undefined;
    if (!user) throw new Error('Bootstrapped admin user disappeared during role update.');
    return user;
  }

  async isEnabledAdmin(userId: string): Promise<boolean> {
    const user = this.db.prepare('SELECT role, banned FROM user WHERE id = ?').get(userId) as
      | { role: string | null; banned: number | null }
      | undefined;
    return Boolean(user && user.banned !== 1 && String(user.role ?? '').split(',').includes('admin'));
  }

  async countEnabledAdmins(): Promise<number> {
    const users = this.db.prepare('SELECT role FROM user WHERE banned IS NULL OR banned = 0').all() as Array<{
      role: string | null;
    }>;
    return users.filter((user) => String(user.role ?? '').split(',').includes('admin')).length;
  }
}

export class SQLiteDBAdapter implements DBAdapter {
  readonly authDatabase: NonNullable<BetterAuthOptions['database']>;
  readonly traces: TraceStore;
  readonly lessons: LessonStore;
  readonly users: UserAdminStore;
  private closed = false;

  constructor(dbPath: string) {
    const db = openDb(dbPath);
    this.db = db;
    this.authDatabase = db as NonNullable<BetterAuthOptions['database']>;
    this.traces = new SQLiteTraceStore(new TraceRepository(db));
    this.lessons = new SQLiteLessonStore(new LessonRepository(db));
    this.users = new SQLiteUserAdminStore(db);
  }

  private readonly db: SqliteDb;

  async initialize(): Promise<void> {}

  async transaction<T>(work: (session: DBSession) => Promise<T>): Promise<T> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = await work(this);
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}
