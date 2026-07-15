import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { requireScope } from '../authPrincipal.js';

const listQuery = z.object({
  status: z.enum(['pending_review', 'rejected', 'promoted']).optional(),
  mine: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
const editBody = z.object({
  quote: z.string().min(1).optional(),
  what_changed: z.string().min(1).optional(),
  why_it_matters: z.string().min(1).optional(),
  reject: z.boolean().optional(),
});
const promoteBody = z.object({
  quote: z.string().min(1).optional(),
  what_changed: z.string().min(1).optional(),
  why_it_matters: z.string().min(1).optional(),
});

export function lessonsRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/', requireScope('birdie:read'), (req, res) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    res.json(
      ctx.lessonService.list({
        status: parsed.data.status,
        q: parsed.data.q,
        limit: parsed.data.limit,
        submitted_by_user_id: parsed.data.mine ? req.user!.id : undefined,
      })
    );
  });

  router.get('/:id', requireScope('birdie:read'), (req, res) => {
    const lesson = ctx.lessonService.get(req.params.id);
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
    res.json(lesson);
  });

  router.patch('/:id', requireScope('birdie:write'), (req, res) => {
    const parsed = editBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    try {
      res.json(ctx.lessonService.review(req.params.id, parsed.data));
    } catch (err) {
      sendServiceError(res, err);
    }
  });

  router.post('/:id/promote', requireScope('birdie:write'), (req, res) => {
    const parsed = promoteBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    try {
      res.json(
        ctx.lessonService.promote(req.params.id, {
          ...parsed.data,
          reviewer: req.user!.name,
          reviewer_user_id: req.user!.id,
        })
      );
    } catch (err) {
      sendServiceError(res, err);
    }
  });

  router.delete('/:id', requireScope('birdie:write'), (req, res) => {
    try {
      ctx.lessonService.delete(req.params.id);
      res.status(204).end();
    } catch (err) {
      sendServiceError(res, err);
    }
  });

  return router;
}

function sendServiceError(res: { status: (code: number) => { json: (body: unknown) => void } }, err: unknown): void {
  const message = (err as Error).message;
  res.status(message.includes('not found') ? 404 : 400).json({ error: message });
}
