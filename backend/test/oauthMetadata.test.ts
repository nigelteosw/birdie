import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { createBirdieAuth } from '../src/auth.js';
import { initializeAuth } from '../src/authBootstrap.js';
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

  it('lets a client registered from the protected-resource scopes request offline_access at authorize', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'birdie-oauth-'));
    const config: HostedConfig = {
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
    const runtime = createBirdieAuth(config);
    await initializeAuth(runtime, config);
    const app = createServer(buildHostedContext(':memory:', config.domainPath), {
      auth: runtime.auth,
      baseUrl: config.baseUrl,
    });
    const listener = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => listener.once('listening', resolve));

    try {
      const address = listener.address();
      if (!address || typeof address === 'string') throw new Error('Expected a TCP listener.');
      const base = `http://127.0.0.1:${address.port}`;

      const resourceMetadata = await fetch(`${base}/.well-known/oauth-protected-resource`).then((r) => r.json()) as {
        scopes_supported: string[];
      };

      // A spec-compliant MCP client registers using exactly the scopes the
      // protected resource advertises as relevant to it.
      const registration = await fetch(`${base}/api/auth/oauth2/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          redirect_uris: ['http://localhost:1234/callback'],
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          scope: resourceMetadata.scopes_supported.join(' '),
        }),
      }).then((r) => r.json()) as { client_id: string };

      // The client then separately asks for offline_access at authorize time
      // to obtain a refresh token, per standard MCP OAuth client behavior.
      const authorizeUrl = new URL(`${base}/api/auth/oauth2/authorize`);
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('client_id', registration.client_id);
      authorizeUrl.searchParams.set('redirect_uri', 'http://localhost:1234/callback');
      authorizeUrl.searchParams.set('scope', [...resourceMetadata.scopes_supported, 'offline_access'].join(' '));
      authorizeUrl.searchParams.set('code_challenge', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
      authorizeUrl.searchParams.set('code_challenge_method', 'S256');
      authorizeUrl.searchParams.set('state', 'teststate');

      const authorizeResponse = await fetch(authorizeUrl, { redirect: 'manual' });
      const location = authorizeResponse.headers.get('location') ?? '';

      expect(location).not.toContain('error=invalid_scope');
    } finally {
      await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
      runtime.database.close();
    }
  });
});
