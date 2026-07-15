import { beforeEach, describe, expect, it } from 'bun:test';
import { SQLiteDBAdapter } from '../src/adapters/sqlite/dbAdapter.js';
import { LessonService } from '../src/services/lessonService.js';
import { TraceService } from '../src/services/traceService.js';

describe('services', () => {
  let traceService: TraceService;
  let lessonService: LessonService;

  beforeEach(() => {
    const db = new SQLiteDBAdapter(':memory:');
    traceService = new TraceService(db);
    lessonService = new LessonService(db);
  });

  it('extracts once and marks the trace extracted', async () => {
    const trace = await traceService.capture({
      submitted_by: 'Jane',
      before_text: 'uncapped indemnity',
      after_text: 'capped indemnity',
    });
    const lesson = await traceService.extract({
      trace_id: trace.id,
      quote: 'uncapped indemnity',
      what_changed: 'Capped it.',
      why_it_matters: 'Risk control.',
    });
    expect(lesson.quote_verified).toBe(true);
    expect((await traceService.get(trace.id))?.status).toBe('extracted');
    await expect(
      traceService.extract({
        trace_id: trace.id,
        quote: 'uncapped indemnity',
        what_changed: 'Again.',
        why_it_matters: 'Again.',
      })
    ).rejects.toThrow(/already/);
  });

  it('rechecks quote verification on edit and promotion', async () => {
    const trace = await traceService.capture({
      submitted_by: 'Jane',
      before_text: 'uncapped indemnity',
      after_text: 'capped indemnity',
    });
    const lesson = await traceService.extract({
      trace_id: trace.id,
      quote: 'not present',
      what_changed: 'Capped it.',
      why_it_matters: 'Risk control.',
    });
    expect(lesson.quote_verified).toBe(false);
    const edited = await lessonService.review(lesson.id, { quote: 'uncapped indemnity' });
    expect(edited.quote_verified).toBe(true);
    const promoted = await lessonService.promote(lesson.id, { reviewer: 'Sarah', quote: 'not present' });
    expect(promoted.quote_verified).toBe(false);
    expect(promoted.status).toBe('promoted');
  });

  it('preserves stable user ids alongside display-name snapshots', async () => {
    const trace = await traceService.capture({
      submitted_by: 'Jane',
      submitted_by_user_id: 'user-1',
      before_text: 'uncapped indemnity',
      after_text: 'capped indemnity',
    });
    expect(trace.submitted_by).toBe('Jane');
    expect(trace.submitted_by_user_id).toBe('user-1');

    const lesson = await traceService.extract({
      trace_id: trace.id,
      quote: 'uncapped indemnity',
      what_changed: 'Capped it.',
      why_it_matters: 'Risk control.',
    });
    const promoted = await lessonService.promote(lesson.id, {
      reviewer: 'Sarah',
      reviewer_user_id: 'user-2',
    });
    expect(promoted.reviewer).toBe('Sarah');
    expect(promoted.reviewer_user_id).toBe('user-2');
    expect(promoted.submitted_by_user_id).toBe('user-1');
  });

  it('deletes a promoted lesson', async () => {
    const trace = await traceService.capture({
      submitted_by: 'Jane',
      before_text: 'uncapped indemnity',
      after_text: 'capped indemnity',
    });
    const lesson = await traceService.extract({
      trace_id: trace.id,
      quote: 'uncapped indemnity',
      what_changed: 'Capped it.',
      why_it_matters: 'Risk control.',
    });
    const promoted = await lessonService.promote(lesson.id, { reviewer: 'Sarah' });
    await lessonService.delete(promoted.id);
    expect(await lessonService.get(promoted.id)).toBeUndefined();
    await expect(lessonService.delete(promoted.id)).rejects.toThrow(/not found/);
  });

  it('refuses to delete a lesson that has not been promoted', async () => {
    const trace = await traceService.capture({
      submitted_by: 'Jane',
      before_text: 'uncapped indemnity',
      after_text: 'capped indemnity',
    });
    const lesson = await traceService.extract({
      trace_id: trace.id,
      quote: 'uncapped indemnity',
      what_changed: 'Capped it.',
      why_it_matters: 'Risk control.',
    });
    await expect(lessonService.delete(lesson.id)).rejects.toThrow(/cannot be deleted/);
    expect(await lessonService.get(lesson.id)).toBeDefined();
  });
});
