import { verifyQuote } from '../extraction.js';
import type { DBAdapter, DBSession } from '../adapters/types.js';
import type {
  GuidanceCheckResult,
  GuidanceContext,
  LessonEdit,
  LessonFilters,
  LessonWithTrace,
  MergeLessonPayload,
  PromotePayload,
} from '../types.js';

export class LessonService {
  constructor(private readonly db: DBAdapter) {}

  list(filters: LessonFilters): Promise<LessonWithTrace[]> {
    return this.db.lessons.list(filters);
  }

  get(id: string): Promise<LessonWithTrace | undefined> {
    return this.db.lessons.getById(id);
  }

  async checkGuidance(context: GuidanceContext): Promise<GuidanceCheckResult> {
    const query = [
      context.task,
      context.artifact_type,
      context.stage,
      context.workspace,
      context.relevant_excerpt,
    ]
      .filter((value): value is string => Boolean(value?.trim()))
      .join(' ');
    const candidates = await this.db.lessons.list({
      status: 'promoted',
      q: query,
      limit: 5,
    });
    return { outcome: candidates.length > 0 ? 'available' : 'none', candidates };
  }

  async findSimilar(id: string, limit = 5): Promise<LessonWithTrace[]> {
    const lesson = await this.get(id);
    if (!lesson) throw new Error(`Lesson not found: ${id}`);
    const matches = await this.db.lessons.list({
      q: `${lesson.what_changed} ${lesson.why_it_matters}`,
      limit: Math.min(Math.max(limit + 1, 2), 10),
    });
    return matches
      .filter((candidate) =>
        candidate.id !== id &&
        candidate.status !== 'rejected' &&
        !candidate.merged_into_lesson_id
      )
      .slice(0, limit);
  }

  merge(
    sourceId: string,
    targetId: string,
    reviewer: MergeLessonPayload
  ): Promise<LessonWithTrace> {
    return this.db.transaction(async (session) => {
      const source = await this.requireLesson(session, sourceId);
      const target = await this.requireLesson(session, targetId);
      if (source.id === target.id) throw new Error('A lesson cannot be merged into itself');
      if (source.status !== 'pending_review') throw new Error('Only pending lessons can be merged');
      if (target.status === 'rejected') throw new Error('Cannot merge into rejected guidance');
      return session.lessons.merge(sourceId, targetId, reviewer);
    });
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
