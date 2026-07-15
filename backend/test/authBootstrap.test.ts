import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { createBirdieAuth } from '../src/auth.js';
import { bootstrapAdmin, initializeAuth } from '../src/authBootstrap.js';
import type { HostedConfig } from '../src/runtimeConfig.js';

function config(): HostedConfig {
  const dir = mkdtempSync(join(tmpdir(), 'birdie-auth-'));
  return {
    secret: 'x'.repeat(32),
    baseUrl: 'http://127.0.0.1:6677',
    adminEmail: 'admin@example.com',
    adminPassword: 'temporary-password-123',
    adminName: 'Birdie Admin',
    port: 6677,
    mcpInternalPort: 6678,
    dbPath: join(dir, 'birdie.db'),
    domainPath: join(dir, 'domain.md'),
  };
}

describe('auth bootstrap', () => {
  it('migrates auth storage and creates a usable admin once', async () => {
    const settings = config();
    const runtime = createBirdieAuth(settings);
    const first = await initializeAuth(runtime, settings);
    const second = await initializeAuth(runtime, settings);

    expect(first.created).toBe(true);
    expect(first.user.email).toBe(settings.adminEmail);
    expect(first.user.role).toBe('admin');
    expect(second.created).toBe(false);

    const signedIn = await runtime.auth.api.signInEmail({
      body: { email: settings.adminEmail, password: settings.adminPassword },
    });
    expect(signedIn.user.email).toBe(settings.adminEmail);
  });

  it('promotes an existing account without recreating or resetting it', async () => {
    const calls: string[] = [];
    const store = {
      findByEmail: () => ({ id: 'user-1', email: 'admin@example.com', name: 'Existing', role: 'user' }),
      createUser: async () => {
        calls.push('create');
        throw new Error('must not create');
      },
      setRole: () => {
        calls.push('role');
        return { id: 'user-1', email: 'admin@example.com', name: 'Existing', role: 'admin' };
      },
    };

    const result = await bootstrapAdmin(store, config());
    expect(result.created).toBe(false);
    expect(result.user.role).toBe('admin');
    expect(calls).toEqual(['role']);
  });
});
