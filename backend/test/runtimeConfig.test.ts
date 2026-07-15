import { describe, expect, it } from 'bun:test';
import { readHostedConfig } from '../src/runtimeConfig.js';

const valid = {
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BIRDIE_BASE_URL: 'https://birdie.example.com/',
  BIRDIE_ADMIN_EMAIL: 'Admin@Example.com',
  BIRDIE_ADMIN_PASSWORD: 'temporary-password-123',
};

describe('readHostedConfig', () => {
  it('normalizes the public origin and admin identity', () => {
    expect(readHostedConfig(valid)).toMatchObject({
      baseUrl: 'https://birdie.example.com',
      adminEmail: 'admin@example.com',
      adminName: 'admin',
      port: 6677,
      mcpInternalPort: 6678,
      dbAdapter: 'sqlite',
      dbPath: '/data/birdie.db',
      databaseUrl: undefined,
      domainPath: '/data/domain.md',
    });
  });

  it('selects PostgreSQL when configured with a database URL', () => {
    expect(readHostedConfig({
      ...valid,
      BIRDIE_DB_ADAPTER: 'postgres',
      DATABASE_URL: 'postgresql://birdie:secret@db.example.com:5432/birdie',
    })).toMatchObject({
      dbAdapter: 'postgres',
      databaseUrl: 'postgresql://birdie:secret@db.example.com:5432/birdie',
    });
  });

  it('requires a PostgreSQL URL only for the PostgreSQL adapter', () => {
    expect(() => readHostedConfig({ ...valid, BIRDIE_DB_ADAPTER: 'postgres' })).toThrow('DATABASE_URL');
    expect(() => readHostedConfig({ ...valid, BIRDIE_DB_ADAPTER: 'mysql' })).toThrow('BIRDIE_DB_ADAPTER');
    expect(readHostedConfig({ ...valid, DATABASE_URL: '' }).dbAdapter).toBe('sqlite');
  });

  it('accepts HTTP only for loopback development origins', () => {
    expect(readHostedConfig({ ...valid, BIRDIE_BASE_URL: 'http://127.0.0.1:6677' }).baseUrl).toBe(
      'http://127.0.0.1:6677'
    );
    expect(() => readHostedConfig({ ...valid, BIRDIE_BASE_URL: 'http://birdie.example.com' })).toThrow('HTTPS');
  });

  it('rejects weak secrets and temporary passwords', () => {
    expect(() => readHostedConfig({ ...valid, BETTER_AUTH_SECRET: 'short' })).toThrow('BETTER_AUTH_SECRET');
    expect(() => readHostedConfig({ ...valid, BIRDIE_ADMIN_PASSWORD: 'short' })).toThrow(
      'BIRDIE_ADMIN_PASSWORD'
    );
  });
});
