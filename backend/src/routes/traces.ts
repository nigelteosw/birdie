import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { requireScope } from '../authPrincipal.js';

const createTraceBody = z.object({
  before_text: z.string().min(1),
  after_text: z.string().min(1),
  context_note: z.string().optional(),
});
const captureCorrectionBody = createTraceBody.extend({
  idempotency_key: z.string().trim().min(8).max(200),
  quote: z.string().min(1),
  what_changed: z.string().min(1),
  why_it_matters: z.string().min(1),
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

  router.post('/', requireScope('birdie:write'), async (req, res) => {
    const parsed = createTraceBody.safeParse(req.body);
    if (!parsed.success) return sendZodError(res, parsed.error);
    try {
      res.status(201).json(
        await ctx.traceService.capture({
        ...parsed.data,
        submitted_by: req.user!.name,
        submitted_by_user_id: req.user!.id,
        })
      );
    } catch (err) {
      sendServiceError(res, err);
    }
  });

  router.post('/capture-correction', requireScope('birdie:write'), async (req, res) => {
    const parsed = captureCorrectionBody.safeParse(req.body);
    if (!parsed.success) return sendZodError(res, parsed.error);
    try {
      res.status(201).json(
        await ctx.traceService.captureCorrection({
          ...parsed.data,
          submitted_by: req.user!.name,
          submitted_by_user_id: req.user!.id,
        })
      );
    } catch (err) {
      sendServiceError(res, err);
    }
  });

  router.get('/', requireScope('birdie:read'), async (req, res) => {
    const parsed = statusQuery.safeParse(req.query.status);
    if (!parsed.success) return sendZodError(res, parsed.error);
    try {
      res.json(await ctx.traceService.list(parsed.data));
    } catch (err) {
      sendServiceError(res, err);
    }
  });

  router.get('/:id', requireScope('birdie:read'), async (req, res) => {
    try {
      const trace = await ctx.traceService.get(req.params.id);
      if (!trace) return res.status(404).json({ error: 'Trace not found' });
      res.json(trace);
    } catch (err) {
      sendServiceError(res, err);
    }
  });

  router.post('/:id/skip', requireScope('birdie:write'), async (req, res) => {
    const parsed = skipBody.safeParse(req.body);
    if (!parsed.success) return sendZodError(res, parsed.error);
    try {
      res.json(await ctx.traceService.skip(req.params.id, parsed.data.reason));
    } catch (err) {
      sendServiceError(res, err);
    }
  });

  router.post('/:id/extract', requireScope('birdie:write'), async (req, res) => {
    const parsed = extractBody.safeParse(req.body);
    if (!parsed.success) return sendZodError(res, parsed.error);
    try {
      res.status(201).json(await ctx.traceService.extract({ trace_id: req.params.id, ...parsed.data }));
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
