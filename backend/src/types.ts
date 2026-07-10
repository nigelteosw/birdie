export type TraceStatus = 'captured' | 'extracted' | 'skipped';
export type LessonStatus = 'pending_review' | 'rejected' | 'promoted';
export type PlaybookAlignment = 'aligned' | 'diverges' | 'not_applicable';

export interface Trace {
  id: string;
  submitted_by: string;
  before_text: string;
  after_text: string;
  playbook_ref: string | null;
  playbook_text: string | null;
  context_note: string | null;
  source: string;
  status: TraceStatus;
  skip_reason: string | null;
  created_at: string;
}

export interface NewTrace {
  submitted_by: string;
  before_text: string;
  after_text: string;
  playbook_ref?: string | null;
  playbook_text?: string | null;
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
  typology: string;
  playbook_alignment: PlaybookAlignment | null;
  playbook_note: string | null;
  status: LessonStatus;
  reviewer: string | null;
  reviewed_at: string | null;
  promoted_at: string | null;
  created_at: string;
}

export interface LessonWithTrace extends Lesson {
  submitted_by: string;
  playbook_ref: string | null;
}

export interface NewExtraction {
  trace_id: string;
  quote: string;
  what_changed: string;
  why_it_matters: string;
  typology: string;
  playbook_alignment?: PlaybookAlignment | null;
  playbook_note?: string | null;
}

export interface LessonEdit {
  quote?: string;
  what_changed?: string;
  why_it_matters?: string;
  typology?: string;
  reject?: boolean;
}

export interface PromotePayload {
  reviewer: string;
  quote?: string;
  what_changed?: string;
  why_it_matters?: string;
  typology?: string;
}

export interface LessonFilters {
  status?: LessonStatus;
  typology?: string;
  playbook_ref?: string;
  submitted_by?: string;
  q?: string;
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
  | { mode: 'local' }
  | { mode: 'remote'; server_url: string };
