import { beforeEach, describe, expect, it } from 'bun:test';
import { openDb } from '../src/db.js';
import type { SqliteDb } from '../src/db.js';
import { loadDomainProfile } from '../src/domain.js';
import { LessonRepository } from '../src/repositories/lessonRepository.js';
import { TraceRepository } from '../src/repositories/traceRepository.js';
import { LessonService } from '../src/services/lessonService.js';
import { TraceService } from '../src/services/traceService.js';

describe('services', () => {
  let db: SqliteDb;
  let traceService: TraceService;
  let lessonService: LessonService;

  beforeEach(() => {
    db = openDb(':memory:');
    const traces = new TraceRepository(db);
    const lessons = new LessonRepository(db);
    const profile = loadDomainProfile('/nonexistent/domain.md');
    traceService = new TraceService(traces, lessons, profile);
    lessonService = new LessonService(lessons, traces, profile);
  });

  it('extracts once and marks the trace extracted', () => {
    const trace = traceService.capture({
      submitted_by: 'Jane',
      before_text: 'uncapped indemnity',
      after_text: 'capped indemnity',
    });
    const lesson = traceService.extract({
      trace_id: trace.id,
      quote: 'uncapped indemnity',
      what_changed: 'Capped it.',
      why_it_matters: 'Risk control.',
      typology: 'substantive_risk',
    });
    expect(lesson.quote_verified).toBe(true);
    expect(traceService.get(trace.id)?.status).toBe('extracted');
    expect(() =>
      traceService.extract({
        trace_id: trace.id,
        quote: 'uncapped indemnity',
        what_changed: 'Again.',
        why_it_matters: 'Again.',
        typology: 'substantive_risk',
      })
    ).toThrow(/already/);
  });

  it('rejects unknown categories on extraction and review', () => {
    const trace = traceService.capture({
      submitted_by: 'Jane',
      before_text: 'a',
      after_text: 'b',
    });
    expect(() =>
      traceService.extract({
        trace_id: trace.id,
        quote: 'a',
        what_changed: 'x',
        why_it_matters: 'y',
        typology: 'unknown',
      })
    ).toThrow(/Unknown category/);

    const lesson = traceService.extract({
      trace_id: trace.id,
      quote: 'a',
      what_changed: 'x',
      why_it_matters: 'y',
      typology: 'other',
    });
    expect(() => lessonService.review(lesson.id, { typology: 'unknown' })).toThrow(/Unknown category/);
  });

  it('rechecks quote verification on edit and promotion', () => {
    const trace = traceService.capture({
      submitted_by: 'Jane',
      before_text: 'uncapped indemnity',
      after_text: 'capped indemnity',
    });
    const lesson = traceService.extract({
      trace_id: trace.id,
      quote: 'not present',
      what_changed: 'Capped it.',
      why_it_matters: 'Risk control.',
      typology: 'substantive_risk',
    });
    expect(lesson.quote_verified).toBe(false);
    const edited = lessonService.review(lesson.id, { quote: 'uncapped indemnity' });
    expect(edited.quote_verified).toBe(true);
    const promoted = lessonService.promote(lesson.id, { reviewer: 'Sarah', quote: 'not present' });
    expect(promoted.quote_verified).toBe(false);
    expect(promoted.status).toBe('promoted');
  });
});
