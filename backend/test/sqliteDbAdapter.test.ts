import { describe, expect, it } from 'bun:test';
import { SQLiteDBAdapter } from '../src/adapters/sqlite/dbAdapter.js';

describe('SQLiteDBAdapter', () => {
  it('persists the lesson lifecycle and searches promoted lessons', async () => {
    const db = new SQLiteDBAdapter(':memory:');
    await db.initialize();

    const trace = await db.traces.create({
      submitted_by: 'Jane',
      submitted_by_user_id: 'user-1',
      before_text: 'uncapped indemnity',
      after_text: 'capped indemnity',
    });
    const pending = await db.lessons.create({
      trace_id: trace.id,
      quote: 'uncapped indemnity',
      quote_verified: true,
      what_changed: 'Capped the exposure.',
      why_it_matters: 'Controls liability risk.',
    });
    await db.lessons.promote(pending.id, { reviewer: 'Sarah' });

    const results = await db.lessons.list({ status: 'promoted', q: 'liability', limit: 5 });
    expect(results.map((lesson) => lesson.id)).toEqual([pending.id]);
    expect(db.authDatabase).toBeDefined();
    await db.close();
  });

  it('rolls back a failed transaction', async () => {
    const db = new SQLiteDBAdapter(':memory:');
    await db.initialize();

    await expect(db.transaction(async (session) => {
      await session.traces.create({ submitted_by: 'Jane', before_text: 'before', after_text: 'after' });
      throw new Error('stop');
    })).rejects.toThrow('stop');

    expect(await db.traces.list()).toHaveLength(0);
    await db.close();
  });
});
