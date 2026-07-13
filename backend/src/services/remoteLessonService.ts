import { requestJson } from './http.js';
import type { LessonEdit, LessonFilters, LessonWithTrace, PromotePayload } from '../types.js';

export class RemoteLessonService {
  constructor(private serverUrl: string) {}

  list(filters: LessonFilters): Promise<LessonWithTrace[]> {
    return requestJson<LessonWithTrace[]>(this.serverUrl, `/lessons${query({ ...filters })}`);
  }

  async get(id: string): Promise<LessonWithTrace | undefined> {
    try {
      return await requestJson<LessonWithTrace>(this.serverUrl, `/lessons/${encodeURIComponent(id)}`);
    } catch (err) {
      if ((err as Error).message.includes('not found')) return undefined;
      throw err;
    }
  }

  review(id: string, changes: LessonEdit): Promise<LessonWithTrace> {
    return requestJson<LessonWithTrace>(this.serverUrl, `/lessons/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    });
  }

  promote(id: string, payload: PromotePayload): Promise<LessonWithTrace> {
    return requestJson<LessonWithTrace>(this.serverUrl, `/lessons/${encodeURIComponent(id)}/promote`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}
