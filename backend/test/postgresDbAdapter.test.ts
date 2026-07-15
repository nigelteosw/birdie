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
    } finally {
      await db.close();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    }
  });
});
