import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'bun:test';
import { Pool } from 'pg';
import { PostgresDBAdapter } from '../src/adapters/postgres/dbAdapter.js';

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const postgresDescribe = databaseUrl ? describe : describe.skip;

postgresDescribe('PostgresDBAdapter', () => {
  it('persists and ranks promoted lessons with pgvector', async () => {
    const schema = `birdie_test_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const db = new PostgresDBAdapter({ connectionString: databaseUrl!, schema });

    try {
      await db.initialize();
      const trace = await db.traces.create({
        submitted_by: 'Jane',
        before_text: 'uncapped indemnity',
        after_text: 'capped indemnity',
      });
      const lesson = await db.lessons.create({
        trace_id: trace.id,
        quote: 'uncapped indemnity',
        quote_verified: true,
        what_changed: 'Capped the exposure.',
        why_it_matters: 'Controls liability risk.',
      });

      const pendingResults = await db.lessons.list({ status: 'pending_review', q: 'liability cap', limit: 5 });
      expect(pendingResults.map((result) => result.id)).toEqual([lesson.id]);

      await db.lessons.promote(lesson.id, { reviewer: 'Sarah' });

      const results = await db.lessons.list({ status: 'promoted', q: 'liability cap', limit: 5 });
      expect(results.map((result) => result.id)).toEqual([lesson.id]);

      const duplicateTrace = await db.traces.create({
        submitted_by: 'Sam',
        before_text: 'reply later',
        after_text: 'reply by Tuesday',
      });
      const duplicate = await db.lessons.create({
        trace_id: duplicateTrace.id,
        quote: 'later',
        quote_verified: true,
        what_changed: 'Use a concrete response deadline.',
        why_it_matters: 'Concrete deadlines make follow-up clear.',
      });
      const merged = await db.lessons.merge(duplicate.id, lesson.id, { reviewer: 'Taylor' });
      expect(merged.merged_into_lesson_id).toBe(lesson.id);
      expect(merged.status).toBe('rejected');
    } finally {
      await db.close();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    }
  });
});
