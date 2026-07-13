import express, { type Express } from 'express';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import type { AppContext } from './context.js';
import { lessonsRouter } from './routes/lessons.js';
import { tracesRouter } from './routes/traces.js';

export function createServer(ctx: AppContext): Express {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/traces', tracesRouter(ctx));
  app.use('/lessons', lessonsRouter(ctx));
  app.get('/domain', (_req, res) => {
    res.json({ content: ctx.domainProfile.raw, typology_categories: ctx.domainProfile.typology_categories });
  });
  app.put('/domain', (req, res) => {
    const parsed = z.object({ content: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    try {
      const result = ctx.updateDomainProfile(parsed.data.content);
      res.json({ content: result.profile.raw, typology_categories: result.profile.typology_categories });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
  // Identity marker so other Birdie processes can confirm a port is really
  // ours before reusing it, instead of assuming whatever answers is Birdie.
  app.get('/__birdie', (_req, res) => {
    res.json({ birdie: true });
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
