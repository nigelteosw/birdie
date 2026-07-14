import { verifyQuote } from '../extraction.js';
import type { LessonRepository } from '../repositories/lessonRepository.js';
import type { TraceRepository } from '../repositories/traceRepository.js';
import type { LessonWithTrace, NewExtraction, NewTrace, Trace, TraceStatus } from '../types.js';

export class TraceService {
  constructor(
    private traces: TraceRepository,
    private lessons: LessonRepository
  ) {}

  capture(input: NewTrace): Trace {
    return this.traces.create(input);
  }

  get(id: string): Trace | undefined {
    return this.traces.getById(id);
  }

  list(status?: TraceStatus): Trace[] {
    return this.traces.list(status);
  }

  skip(id: string, reason: string): Trace {
    const trace = this.requireTrace(id);
    if (trace.status !== 'captured') {
      throw new Error(`Trace ${id} cannot be skipped from status '${trace.status}'`);
    }
    this.traces.markSkipped(id, reason);
    return this.requireTrace(id);
  }

  extract(input: NewExtraction): LessonWithTrace {
    const trace = this.requireTrace(input.trace_id);
    if (trace.status !== 'captured') {
      throw new Error(`Trace ${input.trace_id} was already ${trace.status}`);
    }
    if (this.lessons.getByTraceId(input.trace_id)) {
      throw new Error(`Trace ${input.trace_id} already has a lesson`);
    }
    const lesson = this.lessons.create({
      ...input,
      quote_verified: verifyQuote(input.quote, trace.before_text),
    });
    this.traces.markExtracted(input.trace_id);
    return lesson;
  }

  private requireTrace(id: string): Trace {
    const trace = this.traces.getById(id);
    if (!trace) throw new Error(`Trace not found: ${id}`);
    return trace;
  }
}
