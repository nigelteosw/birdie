import { requestJson } from './http.js';
import type {
  JuniorStrugglesResult,
  LessonEdit,
  LessonFilters,
  LessonWithTrace,
  PromotePayload,
} from '../types.js';

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

  askSeniorApproach(question: string, senior_name?: string): Promise<LessonWithTrace[]> {
    return requestJson<LessonWithTrace[]>(
      this.serverUrl,
      `/lessons/ask/senior-approach${query({ question, senior_name })}`
    );
  }

  askJuniorStruggles(junior_name?: string): Promise<JuniorStrugglesResult> {
    return requestJson<JuniorStrugglesResult>(this.serverUrl, `/lessons/ask/junior-struggles${query({ junior_name })}`);
  }
}

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}
