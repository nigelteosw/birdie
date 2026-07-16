import { verifyQuote } from '../extraction.js';
import type { DBAdapter, DBSession } from '../adapters/types.js';
import type { LessonEdit, LessonFilters, LessonWithTrace, PromotePayload } from '../types.js';

export class LessonService {
  constructor(private readonly db: DBAdapter) {}

  list(filters: LessonFilters): Promise<LessonWithTrace[]> {
    return this.db.lessons.list(filters);
  }

  get(id: string): Promise<LessonWithTrace | undefined> {
    return this.db.lessons.getById(id);
  }

  async review(id: string, changes: LessonEdit): Promise<LessonWithTrace> {
    return this.db.transaction(async (session) => {
      const current = await this.requireLesson(session, id);
      return session.lessons.edit(id, {
        ...changes,
        quote_verified: changes.quote === undefined
          ? current.quote_verified
          : await this.verifyLessonQuote(session, current.trace_id, changes.quote),
      });
    });
  }

  async promote(id: string, payload: PromotePayload): Promise<LessonWithTrace> {
    return this.db.transaction(async (session) => {
      const current = await this.requireLesson(session, id);
      const quoteVerified = payload.quote === undefined
        ? current.quote_verified
        : await this.verifyLessonQuote(session, current.trace_id, payload.quote);
      if (!quoteVerified) {
        throw new Error('A verified quote from the original work is required before promotion');
      }
      return session.lessons.promote(id, {
        ...payload,
        quote_verified: true,
      });
    });
  }

  delete(id: string): Promise<void> {
    return this.db.transaction((session) => session.lessons.delete(id));
  }

  private async requireLesson(session: DBSession, id: string): Promise<LessonWithTrace> {
    const lesson = await session.lessons.getById(id);
    if (!lesson) throw new Error(`Lesson not found: ${id}`);
    return lesson;
  }

  private async verifyLessonQuote(session: DBSession, traceId: string, quote: string): Promise<boolean> {
    const trace = await session.traces.getById(traceId);
    if (!trace) throw new Error(`Trace not found: ${traceId}`);
    return verifyQuote(quote, trace.before_text);
  }
}
