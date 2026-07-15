export type TraceStatus = 'captured' | 'extracted' | 'skipped';
export type LessonStatus = 'pending_review' | 'rejected' | 'promoted';

export interface Trace {
  id: string;
  submitted_by: string;
  submitted_by_user_id: string | null;
  before_text: string;
  after_text: string;
  context_note: string | null;
  source: string;
  status: TraceStatus;
  skip_reason: string | null;
  created_at: string;
}

export interface NewTrace {
  submitted_by: string;
  submitted_by_user_id?: string | null;
  before_text: string;
  after_text: string;
  context_note?: string | null;
  source?: string;
}

export interface Lesson {
  id: string;
  trace_id: string;
  quote: string;
  quote_verified: boolean;
  what_changed: string;
  why_it_matters: string;
  status: LessonStatus;
  reviewer: string | null;
  reviewer_user_id: string | null;
  reviewed_at: string | null;
  promoted_at: string | null;
  created_at: string;
}

export interface LessonWithTrace extends Lesson {
  submitted_by: string;
  submitted_by_user_id: string | null;
}

export interface NewExtraction {
  trace_id: string;
  quote: string;
  what_changed: string;
  why_it_matters: string;
}

export interface LessonEdit {
  quote?: string;
  what_changed?: string;
  why_it_matters?: string;
  reject?: boolean;
}

export interface PromotePayload {
  reviewer: string;
  reviewer_user_id?: string | null;
  quote?: string;
  what_changed?: string;
  why_it_matters?: string;
}

export interface LessonFilters {
  status?: LessonStatus;
  submitted_by?: string;
  submitted_by_user_id?: string;
  q?: string;
  limit?: number;
}

export interface TraceServiceLike {
  capture(input: NewTrace): Trace | Promise<Trace>;
  get(id: string): Trace | undefined | Promise<Trace | undefined>;
  list(status?: TraceStatus): Trace[] | Promise<Trace[]>;
  skip(id: string, reason: string): Trace | Promise<Trace>;
  extract(input: NewExtraction): LessonWithTrace | Promise<LessonWithTrace>;
}

export interface LessonServiceLike {
  list(filters: LessonFilters): LessonWithTrace[] | Promise<LessonWithTrace[]>;
  get(id: string): LessonWithTrace | undefined | Promise<LessonWithTrace | undefined>;
  review(id: string, changes: LessonEdit): LessonWithTrace | Promise<LessonWithTrace>;
  promote(id: string, payload: PromotePayload): LessonWithTrace | Promise<LessonWithTrace>;
}

export type BirdieConfig =
  | { mode: 'local'; user_name?: string }
  | { mode: 'remote'; server_url: string; user_name?: string };
