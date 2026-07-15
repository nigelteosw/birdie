import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { requireScope } from '../authPrincipal.js';

const createTraceBody = z.object({
  before_text: z.string().min(1),
  after_text: z.string().min(1),
  context_note: z.string().optional(),
});

const statusQuery = z.enum(['captured', 'extracted', 'skipped']).optional();
const skipBody = z.object({ reason: z.string().min(1) });
const extractBody = z.object({
  quote: z.string().min(1),
  what_changed: z.string().min(1),
  why_it_matters: z.string().min(1),
});

export function tracesRouter(ctx: AppContext): Router {
  const router = Router();

  router.post('/', requireScope('birdie:write'), (req, res) => {
    const parsed = createTraceBody.safeParse(req.body);
    if (!parsed.success) return sendZodError(res, parsed.error);
    res.status(201).json(
      ctx.traceService.capture({
        ...parsed.data,
        submitted_by: req.user!.name,
        submitted_by_user_id: req.user!.id,
      })
    );
  });

  router.get('/', requireScope('birdie:read'), (req, res) => {
    const parsed = statusQuery.safeParse(req.query.status);
    if (!parsed.success) return sendZodError(res, parsed.error);
    res.json(ctx.traceService.list(parsed.data));
  });

  router.get('/:id', requireScope('birdie:read'), (req, res) => {
    const trace = ctx.traceService.get(req.params.id);
    if (!trace) return res.status(404).json({ error: 'Trace not found' });
    res.json(trace);
  });

  router.post('/:id/skip', requireScope('birdie:write'), (req, res) => {
    const parsed = skipBody.safeParse(req.body);
    if (!parsed.success) return sendZodError(res, parsed.error);
    try {
      res.json(ctx.traceService.skip(req.params.id, parsed.data.reason));
    } catch (err) {
      sendServiceError(res, err);
    }
  });

  router.post('/:id/extract', requireScope('birdie:write'), (req, res) => {
    const parsed = extractBody.safeParse(req.body);
    if (!parsed.success) return sendZodError(res, parsed.error);
    try {
      res.status(201).json(ctx.traceService.extract({ trace_id: req.params.id, ...parsed.data }));
    } catch (err) {
      sendServiceError(res, err);
    }
  });

  return router;
}

function sendZodError(res: { status: (code: number) => { json: (body: unknown) => void } }, error: z.ZodError): void {
  res.status(400).json({ error: error.message });
}

function sendServiceError(res: { status: (code: number) => { json: (body: unknown) => void } }, err: unknown): void {
  const message = (err as Error).message;
  res.status(message.includes('not found') ? 404 : 400).json({ error: message });
}
