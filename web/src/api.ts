export interface Trace {
  id: string;
  submitted_by: string;
  submitted_by_user_id: string | null;
  before_text: string;
  after_text: string;
  context_note: string | null;
  status: 'captured' | 'extracted' | 'skipped';
  skip_reason: string | null;
  created_at: string;
}

export interface Lesson {
  id: string;
  trace_id: string;
  submitted_by: string;
  submitted_by_user_id: string | null;
  quote: string;
  quote_verified: boolean;
  what_changed: string;
  why_it_matters: string;
  status: 'pending_review' | 'rejected' | 'promoted';
  reviewer: string | null;
  reviewer_user_id: string | null;
  reviewed_at: string | null;
  promoted_at: string | null;
  merged_into_lesson_id: string | null;
  created_at: string;
}

export type NewTrace = Pick<Trace, 'before_text' | 'after_text'> &
  Partial<Pick<Trace, 'context_note'>>;

export function captureTrace(input: NewTrace): Promise<Trace> {
  return post('/traces', input);
}

export interface LessonFilters {
  status?: Lesson['status'];
  mine?: boolean;
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

export function reviewLesson(
  id: string,
  changes: Partial<Pick<Lesson, 'quote' | 'what_changed' | 'why_it_matters'>> & { reject?: boolean }
): Promise<Lesson> {
  return patch(`/lessons/${id}`, changes);
}

export function promoteLesson(
  id: string,
  payload: Partial<Pick<Lesson, 'quote' | 'what_changed' | 'why_it_matters'>>
): Promise<Lesson> {
  return post(`/lessons/${id}/promote`, payload);
}

export function deleteLesson(id: string): Promise<void> {
  return del(`/lessons/${id}`);
}

export function findSimilarLessons(id: string): Promise<Lesson[]> {
  return get(`/lessons/${id}/similar`);
}

export function mergeLesson(id: string, targetLessonId: string): Promise<Lesson> {
  return post(`/lessons/${id}/merge`, { target_lesson_id: targetLessonId });
}

async function get<T>(url: string): Promise<T> {
  return json(await fetch(url, { credentials: 'same-origin' }));
}

async function post<T>(url: string, body: unknown): Promise<T> {
  return json(await fetch(url, request('POST', body)));
}

async function patch<T>(url: string, body: unknown): Promise<T> {
  return json(await fetch(url, request('PATCH', body)));
}

async function del(url: string): Promise<void> {
  await throwIfError(await fetch(url, { method: 'DELETE', credentials: 'same-origin' }));
}

function request(method: string, body: unknown): RequestInit {
  return {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function json<T>(res: Response): Promise<T> {
  await throwIfError(res);
  return res.json() as Promise<T>;
}

async function throwIfError(res: Response): Promise<void> {
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
}

export const AUTH_EXPIRED_EVENT = 'birdie:auth-expired';
