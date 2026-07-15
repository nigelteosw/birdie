import express, { type Express } from 'express';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { toNodeHandler } from 'better-auth/node';
import type { BirdieAuth } from './auth.js';
import {
  createSessionPrincipalResolver,
  requirePrincipal,
  requireScope,
  type PrincipalResolver,
} from './authPrincipal.js';
import type { AppContext } from './context.js';
import { lessonsRouter } from './routes/lessons.js';
import { tracesRouter } from './routes/traces.js';

export interface ServerAuthOptions {
  auth?: BirdieAuth;
  principalResolver?: PrincipalResolver;
}

const rejectAnonymous: PrincipalResolver = { resolve: async () => null };

export function createServer(ctx: AppContext, options: ServerAuthOptions = {}): Express {
  const app = express();
  if (options.auth) {
    const authHandler = toNodeHandler(options.auth);
    app.all(['/api/auth/*', '/.well-known/*'], authHandler);
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

function findWebDist(): string | undefined {
  const candidates = [
    process.env.WEB_DIST_PATH,
    resolve(process.cwd(), 'web/dist'),
    resolve(process.cwd(), '../web/dist'),
  ].filter((path): path is string => Boolean(path));
  return candidates.find((path) => existsSync(join(path, 'index.html')));
}
