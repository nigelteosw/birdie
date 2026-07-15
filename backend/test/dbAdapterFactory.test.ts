import { describe, expect, it } from 'bun:test';
import { createConfiguredDBAdapter } from '../src/adapters/factory.js';
import { SQLiteDBAdapter } from '../src/adapters/sqlite/dbAdapter.js';
import type { HostedConfig } from '../src/runtimeConfig.js';

function config(): HostedConfig {
  return {
    secret: 'x'.repeat(32),
    baseUrl: 'http://127.0.0.1:6677',
    adminEmail: 'admin@example.com',
    adminPassword: 'temporary-password-123',
    adminName: 'Birdie Admin',
    port: 6677,
    mcpInternalPort: 6678,
    dbAdapter: 'sqlite',
    dbPath: ':memory:',
    domainPath: '/nonexistent/domain.md',
  };
}

describe('createConfiguredDBAdapter', () => {
  it('creates SQLite by default', async () => {
    const db = createConfiguredDBAdapter(config());
    expect(db).toBeInstanceOf(SQLiteDBAdapter);
    await db.close();
  });

  it('rejects PostgreSQL without a URL even if called outside config parsing', () => {
    expect(() => createConfiguredDBAdapter({ ...config(), dbAdapter: 'postgres' })).toThrow('DATABASE_URL');
  });
});
