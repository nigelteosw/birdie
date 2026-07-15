import type { IncomingMessage } from 'node:http';
import { oauthProviderResourceClient } from '@better-auth/oauth-provider/resource-client';
import type { BirdieAuthRuntime } from '../auth.js';
import type { AuthenticatedUser, BirdieScope } from '../authPrincipal.js';
import type { HostedConfig } from '../runtimeConfig.js';

export interface McpSession {
  [key: string]: unknown;
  user: AuthenticatedUser;
}

interface AuthUserRow {
  id: string;
  email: string;
  name: string;
  role: string | null;
  banned: number | boolean | null;
}

export function createMcpAuthenticator(runtime: BirdieAuthRuntime, config: HostedConfig) {
  const verifyAccessToken = oauthProviderResourceClient(runtime.auth).getActions().verifyAccessToken;

  return async (req: IncomingMessage): Promise<McpSession> => {
    const authorization = req.headers.authorization;
    const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : undefined;
    const payload = await verifyAccessToken(token, {
      verifyOptions: { audience: `${config.baseUrl}/mcp` },
    });
    if (typeof payload.sub !== 'string') throw new Error('Access token is not associated with a user');

    const user = runtime.database
      .query<AuthUserRow, [string]>('SELECT id, email, name, role, banned FROM user WHERE id = ?')
      .get(payload.sub);
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
