import { describe, expect, it } from 'bun:test';
import { SQLiteDBAdapter } from '../src/adapters/sqlite/dbAdapter.js';
import type { DBAdapter } from '../src/adapters/types.js';
import { LessonService } from '../src/services/lessonService.js';
import { TraceService } from '../src/services/traceService.js';

describe('adapter-backed services', () => {
  it('extracts and searches through an injected DBAdapter', async () => {
    const db = new SQLiteDBAdapter(':memory:');
    let transactionCount = 0;
    const instrumentedDb: DBAdapter = {
      authDatabase: db.authDatabase,
      traces: db.traces,
      lessons: db.lessons,
      users: db.users,
      initialize: () => db.initialize(),
      close: () => db.close(),
      transaction(work) {
        transactionCount += 1;
        return db.transaction(work);
      },
    };
    const traces = new TraceService(instrumentedDb);
    const lessons = new LessonService(instrumentedDb);

    const trace = await traces.capture({
      submitted_by: 'Jane',
      before_text: 'uncapped indemnity',
      after_text: 'capped indemnity',
    });
    const pending = await traces.extract({
      trace_id: trace.id,
      quote: 'uncapped indemnity',
      what_changed: 'Capped it.',
      why_it_matters: 'Controls liability.',
    });
    await lessons.promote(pending.id, { reviewer: 'Sarah' });

    expect(await lessons.list({ status: 'promoted', q: 'liability' })).toHaveLength(1);
    expect((await traces.get(trace.id))?.status).toBe('extracted');
    expect(transactionCount).toBe(2);
    await db.close();
  });
});
