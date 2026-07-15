import express, { type Express } from 'express';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { toNodeHandler } from 'better-auth/node';
import { fromNodeHeaders } from 'better-auth/node';
import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from '@better-auth/oauth-provider';
import { oauthProviderResourceClient } from '@better-auth/oauth-provider/resource-client';
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { BirdieAuth, BirdieAuthRuntime } from './auth.js';
import { mcpResourceScopes } from './mcpScopes.js';
import {
  createSessionPrincipalResolver,
  requirePrincipal,
  requireScope,
  type PrincipalResolver,
} from './authPrincipal.js';
import type { AppContext } from './context.js';
import { lessonsRouter } from './routes/lessons.js';
import { tracesRouter } from './routes/traces.js';
import { adminRouter } from './routes/admin.js';

export interface ServerAuthOptions {
  auth?: BirdieAuth;
  authRuntime?: BirdieAuthRuntime;
  principalResolver?: PrincipalResolver;
  baseUrl?: string;
  mcpTarget?: string;
}

const rejectAnonymous: PrincipalResolver = { resolve: async () => null };

export function createServer(ctx: AppContext, options: ServerAuthOptions = {}): Express {
  const app = express();
  if (options.mcpTarget) {
    app.use(
      '/mcp',
      createProxyMiddleware({
        target: options.mcpTarget,
        changeOrigin: false,
        pathRewrite: () => '/mcp',
        proxyTimeout: 0,
        timeout: 0,
        on: {
          proxyRes(proxyResponse) {
            if (proxyResponse.statusCode === 401 && options.baseUrl) {
              proxyResponse.headers['www-authenticate'] =
                `Bearer resource_metadata="${options.baseUrl}/.well-known/oauth-protected-resource/mcp"`;
            }
          },
          error(_error, _req, res) {
            if ('headersSent' in res && res.headersSent) {
              res.destroy();
              return;
            }
            if ('writeHead' in res) {
              res.writeHead(503, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Birdie MCP is temporarily unavailable' }));
            }
          },
        },
      })
    );
  }
  if (options.auth) {
    const authHandler = toNodeHandler(options.auth);
    mountOAuthMetadata(app, options.auth, options.baseUrl);
    app.all('/api/auth/*', authHandler);
  }

  // Public liveness marker and static auth pages must remain reachable before
  // a session exists.
  app.get('/__birdie', (_req, res) => {
    res.json({ birdie: true });
  });

  app.use(express.json({ limit: '2mb' }));
  const principalResolver = options.principalResolver ??
    (options.auth ? createSessionPrincipalResolver(options.auth) : rejectAnonymous);
  const authenticate = requirePrincipal(principalResolver);
  if (options.authRuntime) app.use('/api/admin', authenticate, adminRouter(options.authRuntime));
  app.use('/traces', authenticate, tracesRouter(ctx));
  app.use('/lessons', authenticate, lessonsRouter(ctx));
  app.get('/domain', authenticate, requireScope('birdie:read'), (_req, res) => {
    res.json({ content: ctx.domainProfile.raw });
  });
  app.put('/domain', authenticate, requireScope('birdie:write'), (req, res) => {
    const parsed = z.object({ content: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    try {
      const result = ctx.updateDomainProfile(parsed.data.content);
      res.json({ content: result.profile.raw });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
  const dist = findWebDist();
  if (dist) {
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(join(dist, 'index.html')));
  }
  return app;
}

function mountOAuthMetadata(app: Express, auth: BirdieAuth, baseUrl?: string): void {
  const authorizationMetadata = oauthProviderAuthServerMetadata(auth);
  const openIdMetadata = oauthProviderOpenIdConfigMetadata(auth);
  app.get([
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-authorization-server/api/auth',
    '/api/auth/.well-known/oauth-authorization-server',
  ], (req, res, next) => {
    forwardMetadata(authorizationMetadata, req, res).catch(next);
  });
  app.get([
    '/.well-known/openid-configuration',
    '/.well-known/openid-configuration/api/auth',
    '/api/auth/.well-known/openid-configuration',
  ], (req, res, next) => {
    forwardMetadata(openIdMetadata, req, res).catch(next);
  });

  if (baseUrl) {
    app.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/*'], async (_req, res, next) => {
      try {
        const metadata = await oauthProviderResourceClient(auth).getActions().getProtectedResourceMetadata({
          resource: `${baseUrl}/mcp`,
          authorization_servers: [`${baseUrl}/api/auth`],
          scopes_supported: [...mcpResourceScopes],
        });
        res.json(metadata);
      } catch (error) {
        next(error);
      }
    });
  }
}

async function forwardMetadata(
  handler: (request: Request) => Promise<Response>,
  req: express.Request,
  res: express.Response
): Promise<void> {
  const response = await handler(
    new Request(`${req.protocol}://${req.get('host')}${req.originalUrl}`, {
      headers: fromNodeHeaders(req.headers),
    })
  );
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const metadata = await response.json() as Record<string, unknown>;
  res.status(response.status).json(prepareAuthorizationMetadata(metadata));
}

export function prepareAuthorizationMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const { authorization_response_iss_parameter_supported: _codexIncompatible, ...compatible } = metadata;
  return compatible;
}

function findWebDist(): string | undefined {
  const candidates = [
    process.env.WEB_DIST_PATH,
    resolve(process.cwd(), 'web/dist'),
    resolve(process.cwd(), '../web/dist'),
  ].filter((path): path is string => Boolean(path));
  return candidates.find((path) => existsSync(join(path, 'index.html')));
}
