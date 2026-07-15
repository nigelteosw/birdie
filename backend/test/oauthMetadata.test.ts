import { describe, expect, it } from 'bun:test';
import { createBirdieAuth } from '../src/auth.js';
import { buildHostedContext } from '../src/context.js';
import { createServer } from '../src/server.js';
import type { HostedConfig } from '../src/runtimeConfig.js';

describe('OAuth discovery metadata', () => {
  it('does not advertise the issuer response check that Codex 0.144.4 cannot parse', async () => {
    const server = await import('../src/server.js') as Record<string, unknown>;

    expect(server.prepareAuthorizationMetadata).toBeFunction();
    const prepareAuthorizationMetadata = server.prepareAuthorizationMetadata as (
      metadata: Record<string, unknown>
    ) => Record<string, unknown>;

    expect(prepareAuthorizationMetadata({
      issuer: 'https://birdie.example.com/api/auth',
      authorization_endpoint: 'https://birdie.example.com/api/auth/oauth2/authorize',
      authorization_response_iss_parameter_supported: true,
    })).toEqual({
      issuer: 'https://birdie.example.com/api/auth',
      authorization_endpoint: 'https://birdie.example.com/api/auth/oauth2/authorize',
    });
  });

  it('sanitizes Better Auth discovery under the configured auth base path', async () => {
    const config: HostedConfig = {
      secret: 'x'.repeat(32),
      baseUrl: 'http://127.0.0.1:6677',
      adminEmail: 'admin@example.com',
      adminPassword: 'temporary-password-123',
      adminName: 'Birdie Admin',
      port: 6677,
      mcpInternalPort: 6678,
      dbPath: ':memory:',
      domainPath: '/nonexistent/domain.md',
    };
    const runtime = createBirdieAuth(config);
    const app = createServer(buildHostedContext(':memory:', config.domainPath), {
      auth: runtime.auth,
      baseUrl: config.baseUrl,
    });
    const listener = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => listener.once('listening', resolve));

    try {
      const address = listener.address();
      if (!address || typeof address === 'string') throw new Error('Expected a TCP listener.');
      const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/.well-known/oauth-authorization-server`);
      const metadata = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(metadata.authorization_response_iss_parameter_supported).toBeUndefined();
    } finally {
      await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
      runtime.database.close();
    }
  });
});
