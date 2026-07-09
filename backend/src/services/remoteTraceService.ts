import { requestJson } from './http.js';
import type { LessonWithTrace, NewExtraction, NewTrace, Trace, TraceStatus } from '../types.js';

export class RemoteTraceService {
  constructor(private serverUrl: string) {}

  capture(input: NewTrace): Promise<Trace> {
    return requestJson<Trace>(this.serverUrl, '/traces', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async get(id: string): Promise<Trace | undefined> {
    try {
      return await requestJson<Trace>(this.serverUrl, `/traces/${encodeURIComponent(id)}`);
    } catch (err) {
      if ((err as Error).message.includes('not found')) return undefined;
      throw err;
    }
  }

  list(status?: TraceStatus): Promise<Trace[]> {
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    return requestJson<Trace[]>(this.serverUrl, `/traces${query}`);
  }

  skip(id: string, reason: string): Promise<Trace> {
    return requestJson<Trace>(this.serverUrl, `/traces/${encodeURIComponent(id)}/skip`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  extract(input: NewExtraction): Promise<LessonWithTrace> {
    const { trace_id, ...body } = input;
    return requestJson<LessonWithTrace>(this.serverUrl, `/traces/${encodeURIComponent(trace_id)}/extract`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }
}
