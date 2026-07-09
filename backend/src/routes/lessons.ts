import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';

const statusQuery = z.enum(['pending_review', 'rejected', 'promoted']).optional();
const editBody = z.object({
  quote: z.string().min(1).optional(),
  what_changed: z.string().min(1).optional(),
  why_it_matters: z.string().min(1).optional(),
  typology: z.string().min(1).optional(),
  reject: z.boolean().optional(),
});
const promoteBody = z.object({
  reviewer: z.string().trim().min(1),
  quote: z.string().min(1).optional(),
  what_changed: z.string().min(1).optional(),
  why_it_matters: z.string().min(1).optional(),
  typology: z.string().min(1).optional(),
});

export function lessonsRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/ask/senior-approach', (req, res) => {
    const question = z.string().min(1).safeParse(req.query.question);
    if (!question.success) return res.status(400).json({ error: question.error.message });
    res.json(ctx.lessonService.askSeniorApproach(question.data, req.query.senior_name as string | undefined));
  });

  router.get('/ask/junior-struggles', (req, res) => {
    res.json(ctx.lessonService.askJuniorStruggles(req.query.junior_name as string | undefined));
  });

  router.get('/', (req, res) => {
    const status = statusQuery.safeParse(req.query.status);
    if (!status.success) return res.status(400).json({ error: status.error.message });
    res.json(
      ctx.lessonService.list({
        status: status.data,
        typology: req.query.typology as string | undefined,
        playbook_ref: req.query.playbook_ref as string | undefined,
        junior_name: req.query.junior_name as string | undefined,
        senior_name: req.query.senior_name as string | undefined,
      })
    );
  });

  router.get('/:id', (req, res) => {
    const lesson = ctx.lessonService.get(req.params.id);
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
    res.json(lesson);
  });

  router.patch('/:id', (req, res) => {
    const parsed = editBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    try {
      res.json(ctx.lessonService.review(req.params.id, parsed.data));
    } catch (err) {
      sendServiceError(res, err);
    }
  });

  router.post('/:id/promote', (req, res) => {
    const parsed = promoteBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    try {
      res.json(ctx.lessonService.promote(req.params.id, parsed.data));
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
