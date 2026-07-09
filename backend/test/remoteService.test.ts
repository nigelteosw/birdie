import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { RemoteLessonService } from '../src/services/remoteLessonService.js';
import { RemoteTraceService } from '../src/services/remoteTraceService.js';

describe('remote services', () => {
  const oldFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  beforeEach(() => {
    calls.length = 0;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return Response.json(responseFor(String(url), init));
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = oldFetch;
  });

  it('maps trace methods to REST routes', async () => {
    const traces = new RemoteTraceService('http://birdie.test');
    await traces.capture({
      submitted_by: 'Jane',
      submitted_by_role: 'junior',
      before_text: 'before',
      after_text: 'after',
    });
    await traces.extract({
      trace_id: 'trace-1',
      quote: 'before',
      what_changed: 'Changed it.',
      why_it_matters: 'Reason.',
      typology: 'other',
    });
    await traces.skip('trace-2', 'Not useful.');

    expect(calls.map((call) => `${call.init?.method ?? 'GET'} ${call.url}`)).toEqual([
      'POST http://birdie.test/traces',
      'POST http://birdie.test/traces/trace-1/extract',
      'POST http://birdie.test/traces/trace-2/skip',
    ]);
  });

  it('maps lesson methods to REST routes', async () => {
    const lessons = new RemoteLessonService('http://birdie.test');
    await lessons.list({ status: 'promoted', junior_name: 'Jane' });
    await lessons.promote('lesson-1', { reviewer: 'Sarah' });
    await lessons.askSeniorApproach('indemnity cap', 'Sarah');
    await lessons.askJuniorStruggles('Jane');

    expect(calls.map((call) => `${call.init?.method ?? 'GET'} ${call.url}`)).toEqual([
      'GET http://birdie.test/lessons?status=promoted&junior_name=Jane',
      'POST http://birdie.test/lessons/lesson-1/promote',
      'GET http://birdie.test/lessons/ask/senior-approach?question=indemnity+cap&senior_name=Sarah',
      'GET http://birdie.test/lessons/ask/junior-struggles?junior_name=Jane',
    ]);
  });
});

function responseFor(url: string, init?: RequestInit): unknown {
  if (url.includes('/ask/junior-struggles')) return { lessons: [], typology_counts: {} };
  if (url.includes('/lessons') && !url.includes('/promote')) return [];
  if (url.includes('/traces') && init?.method === 'POST' && !url.includes('/extract')) {
    return { id: 'trace-1', status: 'captured' };
  }
  return { id: 'lesson-1', status: 'promoted' };
}
