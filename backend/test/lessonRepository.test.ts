import { beforeEach, describe, expect, it } from 'bun:test';
import { openDb } from '../src/db.js';
import type { SqliteDb } from '../src/db.js';
import { LessonRepository } from '../src/repositories/lessonRepository.js';
import { TraceRepository } from '../src/repositories/traceRepository.js';

describe('LessonRepository filters', () => {
  let db: SqliteDb;
  let traces: TraceRepository;
  let lessons: LessonRepository;

  beforeEach(() => {
    db = openDb(':memory:');
    traces = new TraceRepository(db);
    lessons = new LessonRepository(db);
  });

  function createPromotedLesson(
    submittedBy: string,
    quote: string,
    whatChanged: string,
    whyItMatters: string,
    submittedByUserId?: string
  ) {
    const trace = traces.create({
      submitted_by: submittedBy,
      submitted_by_user_id: submittedByUserId,
      before_text: quote,
      after_text: 'after',
    });
    const lesson = lessons.create({
      trace_id: trace.id,
      quote,
      quote_verified: true,
      what_changed: whatChanged,
      why_it_matters: whyItMatters,
    });
    return lessons.promote(lesson.id, { reviewer: 'Sarah' });
  }

  it('filters by submitted_by', () => {
    createPromotedLesson('Jane', 'uncapped indemnity', 'Capped it.', 'Risk control.');
    createPromotedLesson('Amir', 'vague notice period', 'Set 30 days.', 'Clarity.');

    const results = lessons.list({ status: 'promoted', submitted_by: 'Jane' });
    expect(results).toHaveLength(1);
    expect(results[0].submitted_by).toBe('Jane');
  });

  it('filters by stable submitter id even when display names collide', () => {
    const jane = createPromotedLesson('Jane', 'uncapped indemnity', 'Capped it.', 'Risk control.', 'user-1');
    createPromotedLesson('Jane', 'vague notice period', 'Set 30 days.', 'Clarity.', 'user-2');

    const results = lessons.list({ status: 'promoted', submitted_by_user_id: 'user-1' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(jane.id);
    expect(results[0].submitted_by_user_id).toBe('user-1');
  });

  it('filters by keyword across quote, what_changed, and why_it_matters', () => {
    createPromotedLesson('Jane', 'uncapped indemnity', 'Capped it.', 'Risk control.');
    createPromotedLesson('Amir', 'vague notice period', 'Set 30 days.', 'Clarity on timing.');

    const byQuote = lessons.list({ status: 'promoted', q: 'indemnity' });
    expect(byQuote).toHaveLength(1);
    expect(byQuote[0].submitted_by).toBe('Jane');

    const byWhyItMatters = lessons.list({ status: 'promoted', q: 'clarity' });
    expect(byWhyItMatters).toHaveLength(1);
    expect(byWhyItMatters[0].submitted_by).toBe('Amir');
  });

  it('keeps the keyword index in sync across edit and promote', () => {
    const trace = traces.create({ submitted_by: 'Jane', before_text: 'draft text', after_text: 'after' });
    const lesson = lessons.create({
      trace_id: trace.id,
      quote: 'draft text',
      quote_verified: true,
      what_changed: 'placeholder',
      why_it_matters: 'placeholder',
    });

    // Not promoted yet, so it shouldn't surface in a promoted-only search.
    expect(lessons.list({ status: 'promoted', q: 'liability' })).toHaveLength(0);

    lessons.edit(lesson.id, { what_changed: 'renegotiated the cap', why_it_matters: 'liability cap negotiated down' });
    lessons.promote(lesson.id, { reviewer: 'Sarah' });

    const results = lessons.list({ status: 'promoted', q: 'liability' });
    expect(results).toHaveLength(1);
    expect(results[0].why_it_matters).toContain('liability cap');

    // The stale "placeholder" text should no longer match after the edit replaced it.
    expect(lessons.list({ status: 'promoted', q: 'placeholder' })).toHaveLength(0);
  });

  it('matches any one of several keywords, mirroring the previous LIKE-based OR search', () => {
    createPromotedLesson('Jane', 'uncapped indemnity', 'Capped it.', 'Risk control.');
    createPromotedLesson('Amir', 'vague notice period', 'Set 30 days.', 'Clarity on timing.');

    const results = lessons.list({ status: 'promoted', q: 'indemnity timing' });
    expect(results.map((lesson) => lesson.submitted_by).sort()).toEqual(['Amir', 'Jane']);
  });

  it('bounds unpaginated lists and honours an explicit limit', () => {
    for (let index = 0; index < 101; index += 1) {
      createPromotedLesson(`Person ${index}`, `term ${index}`, 'Changed it.', 'Reason.');
    }

    expect(lessons.list({ status: 'promoted' })).toHaveLength(100);
    expect(lessons.list({ status: 'promoted', limit: 3 })).toHaveLength(3);
  });

  it('deletes a lesson and drops it from keyword search', () => {
    const promoted = createPromotedLesson('Jane', 'uncapped indemnity', 'Capped it.', 'Risk control.');

    lessons.delete(promoted.id);

    expect(lessons.getById(promoted.id)).toBeUndefined();
    expect(lessons.list({ status: 'promoted', q: 'indemnity' })).toHaveLength(0);
  });

  it('refuses to delete a lesson that is not promoted', () => {
    const trace = traces.create({ submitted_by: 'Jane', before_text: 'a', after_text: 'b' });
    const lesson = lessons.create({
      trace_id: trace.id,
      quote: 'a',
      quote_verified: true,
      what_changed: 'x',
      why_it_matters: 'y',
    });

    expect(() => lessons.delete(lesson.id)).toThrow(/cannot be deleted/);
    expect(lessons.getById(lesson.id)).toBeDefined();
  });
});
