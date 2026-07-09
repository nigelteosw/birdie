import type { DomainProfile } from '../domain.js';
import { verifyQuote } from '../extraction.js';
import type { LessonRepository } from '../repositories/lessonRepository.js';
import type { TraceRepository } from '../repositories/traceRepository.js';
import type {
  JuniorStrugglesResult,
  LessonEdit,
  LessonFilters,
  LessonWithTrace,
  PromotePayload,
} from '../types.js';

export class LessonService {
  constructor(
    private lessons: LessonRepository,
    private traces: TraceRepository,
    private domainProfile: DomainProfile
  ) {}

  list(filters: LessonFilters): LessonWithTrace[] {
    return this.lessons.list(filters);
  }

  get(id: string): LessonWithTrace | undefined {
    return this.lessons.getById(id);
  }

  review(id: string, changes: LessonEdit): LessonWithTrace {
    const current = this.requireLesson(id);
    this.validateTypology(changes.typology);
    return this.lessons.edit(id, {
      ...changes,
      quote_verified: changes.quote === undefined ? current.quote_verified : this.verifyLessonQuote(current.trace_id, changes.quote),
    });
  }

  promote(id: string, payload: PromotePayload): LessonWithTrace {
    const current = this.requireLesson(id);
    this.validateTypology(payload.typology);
    return this.lessons.promote(id, {
      ...payload,
      quote_verified: payload.quote === undefined ? current.quote_verified : this.verifyLessonQuote(current.trace_id, payload.quote),
    });
  }

  askSeniorApproach(question: string, senior_name?: string): LessonWithTrace[] {
    return this.lessons.searchPromoted(question, senior_name);
  }

  askJuniorStruggles(junior_name?: string): JuniorStrugglesResult {
    return this.lessons.strugglesFor(junior_name);
  }

  private requireLesson(id: string): LessonWithTrace {
    const lesson = this.lessons.getById(id);
    if (!lesson) throw new Error(`Lesson not found: ${id}`);
    return lesson;
  }

  private verifyLessonQuote(traceId: string, quote: string): boolean {
    const trace = this.traces.getById(traceId);
    if (!trace) throw new Error(`Trace not found: ${traceId}`);
    return verifyQuote(quote, trace.before_text);
  }

  private validateTypology(typology: string | undefined): void {
    if (typology && !this.domainProfile.typology_categories.includes(typology)) {
      throw new Error(`Unknown category '${typology}'. Valid categories: ${this.domainProfile.typology_categories.join(', ')}`);
    }
  }
}
