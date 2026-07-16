import type { BetterAuthOptions } from 'better-auth';
import type {
  LessonEdit,
  LessonFilters,
  LessonWithTrace,
  MergeLessonPayload,
  NewExtraction,
  NewTrace,
  PromotePayload,
  Trace,
  TraceStatus,
} from '../types.js';

export interface TraceStore {
  create(input: NewTrace): Promise<Trace>;
  getById(id: string): Promise<Trace | undefined>;
  list(status?: TraceStatus): Promise<Trace[]>;
  markExtracted(id: string): Promise<void>;
  markSkipped(id: string, reason: string): Promise<void>;
}

export interface LessonStore {
  create(input: NewExtraction & { quote_verified: boolean }): Promise<LessonWithTrace>;
  getById(id: string): Promise<LessonWithTrace | undefined>;
  getByTraceId(traceId: string): Promise<LessonWithTrace | undefined>;
  getByIds(ids: string[], filters?: Omit<LessonFilters, 'q' | 'limit'>): Promise<LessonWithTrace[]>;
  list(filters: LessonFilters): Promise<LessonWithTrace[]>;
  edit(id: string, changes: LessonEdit & { quote_verified?: boolean }): Promise<LessonWithTrace>;
  promote(id: string, payload: PromotePayload & { quote_verified?: boolean }): Promise<LessonWithTrace>;
  merge(sourceId: string, targetId: string, payload: MergeLessonPayload): Promise<LessonWithTrace>;
  delete(id: string): Promise<void>;
  streamPromoted(): AsyncIterable<LessonWithTrace>;
}

export interface BootstrapUser {
  id: string;
  email: string;
  name: string;
  role?: string | null;
}

export interface AuthUserRecord extends BootstrapUser {
  banned: number | boolean | null;
}

export interface UserAdminStore {
  findByEmail(email: string): Promise<BootstrapUser | undefined>;
  findById(id: string): Promise<AuthUserRecord | undefined>;
  setRole(userId: string, role: 'admin'): Promise<BootstrapUser>;
  isEnabledAdmin(userId: string): Promise<boolean>;
  countEnabledAdmins(): Promise<number>;
}

export interface DBSession {
  traces: TraceStore;
  lessons: LessonStore;
  users: UserAdminStore;
}

export interface DBAdapter extends DBSession {
  readonly authDatabase: NonNullable<BetterAuthOptions['database']>;
  initialize(): Promise<void>;
  transaction<T>(work: (session: DBSession) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
