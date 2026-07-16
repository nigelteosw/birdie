import { verifyQuote } from '../extraction.js';
import type { DBAdapter, TraceStore } from '../adapters/types.js';
import type { LessonWithTrace, NewCorrection, NewExtraction, NewTrace, Trace, TraceStatus } from '../types.js';

export class TraceService {
  constructor(private readonly db: DBAdapter) {}

  capture(input: NewTrace): Promise<Trace> {
    return this.db.traces.create(input);
  }

  captureCorrection(input: NewCorrection): Promise<LessonWithTrace> {
    return this.db.transaction(async (session) => {
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
}
