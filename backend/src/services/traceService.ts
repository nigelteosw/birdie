import { verifyQuote } from '../extraction.js';
import type { DBAdapter, TraceStore } from '../adapters/types.js';
import type { LessonWithTrace, NewCorrection, NewExtraction, NewTrace, Trace, TraceStatus } from '../types.js';

export class TraceService {
  constructor(private readonly db: DBAdapter) {}

  capture(input: NewTrace): Promise<Trace> {
    return this.db.traces.create(input);
  }

  async captureCorrection(input: NewCorrection): Promise<LessonWithTrace> {
    const existing = await this.findCorrectionByIdempotencyKey(input);
    if (existing) return existing;
    try {
      return await this.db.transaction(async (session) => {
        const { quote, what_changed, why_it_matters, ...traceInput } = input;
        const trace = await session.traces.create(traceInput);
        const lesson = await session.lessons.create({
          trace_id: trace.id,
          quote,
          what_changed,
          why_it_matters,
          quote_verified: verifyQuote(quote, trace.before_text),
        });
        await session.traces.markExtracted(trace.id);
        return lesson;
      });
    } catch (error) {
      const retry = await this.findCorrectionByIdempotencyKey(input);
      if (retry) return retry;
      throw error;
    }
  }

  get(id: string): Promise<Trace | undefined> {
    return this.db.traces.getById(id);
  }

  list(status?: TraceStatus): Promise<Trace[]> {
    return this.db.traces.list(status);
  }

  async skip(id: string, reason: string): Promise<Trace> {
    const trace = await this.requireTrace(this.db.traces, id);
    if (trace.status !== 'captured') {
      throw new Error(`Trace ${id} cannot be skipped from status '${trace.status}'`);
    }
    await this.db.traces.markSkipped(id, reason);
    return this.requireTrace(this.db.traces, id);
  }

  extract(input: NewExtraction): Promise<LessonWithTrace> {
    return this.db.transaction(async (session) => {
      const trace = await this.requireTrace(session.traces, input.trace_id);
      if (trace.status !== 'captured') {
        throw new Error(`Trace ${input.trace_id} was already ${trace.status}`);
      }
      if (await session.lessons.getByTraceId(input.trace_id)) {
        throw new Error(`Trace ${input.trace_id} already has a lesson`);
      }
      const lesson = await session.lessons.create({
        ...input,
        quote_verified: verifyQuote(input.quote, trace.before_text),
      });
      await session.traces.markExtracted(input.trace_id);
      return lesson;
    });
  }

  private async requireTrace(traces: TraceStore, id: string): Promise<Trace> {
    const trace = await traces.getById(id);
    if (!trace) throw new Error(`Trace not found: ${id}`);
    return trace;
  }

  private async findCorrectionByIdempotencyKey(input: NewCorrection): Promise<LessonWithTrace | undefined> {
    const trace = await this.db.traces.getByIdempotencyKey(input.idempotency_key);
    if (!trace) return undefined;
    const lesson = await this.db.lessons.getByTraceId(trace.id);
    const matches = lesson &&
      trace.submitted_by === input.submitted_by &&
      trace.submitted_by_user_id === (input.submitted_by_user_id ?? null) &&
      trace.before_text === input.before_text &&
      trace.after_text === input.after_text &&
      trace.context_note === (input.context_note ?? null) &&
      trace.source === (input.source ?? 'manual') &&
      lesson.quote === input.quote &&
      lesson.what_changed === input.what_changed &&
      lesson.why_it_matters === input.why_it_matters;
    if (!matches) {
      throw new Error('Idempotency key was already used for different correction evidence');
    }
    return lesson;
  }
}
