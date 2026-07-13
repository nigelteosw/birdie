export interface Trace {
  id: string;
  submitted_by: string;
  before_text: string;
  after_text: string;
  playbook_ref: string | null;
  playbook_text: string | null;
  context_note: string | null;
  status: 'captured' | 'extracted' | 'skipped';
  skip_reason: string | null;
  created_at: string;
}

export interface Lesson {
  id: string;
  trace_id: string;
  submitted_by: string;
  playbook_ref: string | null;
  quote: string;
  quote_verified: boolean;
  what_changed: string;
  why_it_matters: string;
  typology: string;
  playbook_alignment: 'aligned' | 'diverges' | 'not_applicable' | null;
  playbook_note: string | null;
  status: 'pending_review' | 'rejected' | 'promoted';
  reviewer: string | null;
  reviewed_at: string | null;
  promoted_at: string | null;
  created_at: string;
}

export interface DomainProfile {
  typology_categories: string[];
}

export type NewTrace = Pick<Trace, 'before_text' | 'after_text' | 'submitted_by'> &
  Partial<Pick<Trace, 'playbook_ref' | 'playbook_text' | 'context_note'>>;

export function captureTrace(input: NewTrace): Promise<Trace> {
  return post('/traces', input);
}

export interface LessonFilters {
  status?: Lesson['status'];
  typology?: string;
  submitted_by?: string;
  q?: string;
  limit?: number;
}

export function listLessons(filters: LessonFilters = {}): Promise<Lesson[]> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const text = search.toString();
  return get(`/lessons${text ? `?${text}` : ''}`);
}

export function getDomainProfile(): Promise<DomainProfile> {
  return get('/domain');
}

export function reviewLesson(
  id: string,
  changes: Partial<Pick<Lesson, 'quote' | 'what_changed' | 'why_it_matters' | 'typology'>> & { reject?: boolean }
): Promise<Lesson> {
  return patch(`/lessons/${id}`, changes);
}

export function promoteLesson(
  id: string,
  payload: { reviewer: string } & Partial<Pick<Lesson, 'quote' | 'what_changed' | 'why_it_matters' | 'typology'>>
): Promise<Lesson> {
  return post(`/lessons/${id}/promote`, payload);
}

async function get<T>(url: string): Promise<T> {
  return json(await fetch(url));
}

async function post<T>(url: string, body: unknown): Promise<T> {
  return json(await fetch(url, request('POST', body)));
}

async function patch<T>(url: string, body: unknown): Promise<T> {
  return json(await fetch(url, request('PATCH', body)));
}

function request(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}
