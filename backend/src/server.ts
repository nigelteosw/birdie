import express, { type Express } from 'express';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AppContext } from './context.js';
import { lessonsRouter } from './routes/lessons.js';
import { tracesRouter } from './routes/traces.js';

export function createServer(ctx: AppContext): Express {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/traces', tracesRouter(ctx));
  app.use('/lessons', lessonsRouter(ctx));
  app.get('/domain', (_req, res) => {
    res.json({ typology_categories: ctx.domainProfile.typology_categories });
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
