import type { IncomingMessage } from 'node:http';
import { oauthProviderResourceClient } from '@better-auth/oauth-provider/resource-client';
import type { BirdieAuthRuntime } from '../auth.js';
import type { AuthenticatedUser, BirdieScope } from '../authPrincipal.js';
import type { HostedConfig } from '../runtimeConfig.js';
import type { UserAdminStore } from '../adapters/types.js';

export interface McpSession {
  [key: string]: unknown;
  user: AuthenticatedUser;
}

export function createMcpAuthenticator(
  runtime: BirdieAuthRuntime,
  config: HostedConfig,
  users: UserAdminStore
) {
  const verifyAccessToken = oauthProviderResourceClient(runtime.auth).getActions().verifyAccessToken;

  return async (req: IncomingMessage): Promise<McpSession> => {
    const authorization = req.headers.authorization;
    const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : undefined;
    const payload = await verifyAccessToken(token, {
      verifyOptions: {
        audience: `${config.baseUrl}/mcp`,
        issuer: `${config.baseUrl}/api/auth`,
      },
    });
    if (typeof payload.sub !== 'string') throw new Error('Access token is not associated with a user');

    const user = await users.findById(payload.sub);
    if (!user || user.banned === true || user.banned === 1) throw new Error('User is disabled');

    const scopes = new Set(
      String(payload.scope ?? '')
        .split(/\s+/)
        .filter((scope): scope is BirdieScope => scope === 'birdie:read' || scope === 'birdie:write')
    );
    if (scopes.size === 0) throw new Error('Access token has no Birdie scopes');

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name || user.email,
        role: String(user.role ?? 'user').split(',').includes('admin') ? 'admin' : 'user',
        scopes,
        disabled: false,
      },
    };
  };
}
