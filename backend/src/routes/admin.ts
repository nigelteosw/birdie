import { Router } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { z } from 'zod';
import type { BirdieAuthRuntime } from '../auth.js';
import type { UserAdminStore } from '../adapters/types.js';
import { requireAdmin } from '../authPrincipal.js';

const createUserBody = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email(),
  password: z.string().min(12),
});
const passwordBody = z.object({ password: z.string().min(12) });

export function adminRouter(runtime: BirdieAuthRuntime, users: UserAdminStore): Router {
  const router = Router();
  router.use(requireAdmin);

  router.get('/users', async (req, res) => {
    try {
      const result = await runtime.auth.api.listUsers({
        headers: fromNodeHeaders(req.headers),
        query: { limit: 100 },
      });
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/users', async (req, res) => {
    const parsed = createUserBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    try {
      const result = await runtime.auth.api.createUser({
        headers: fromNodeHeaders(req.headers),
        body: { ...parsed.data, role: 'user' },
      });
      res.status(201).json(result.user);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/users/:id/password', async (req, res) => {
    const parsed = passwordBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    try {
      await runtime.auth.api.setUserPassword({
        headers: fromNodeHeaders(req.headers),
        body: { userId: req.params.id, newPassword: parsed.data.password },
      });
      res.status(204).end();
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/users/:id/ban', async (req, res) => {
    try {
      if (await users.isEnabledAdmin(req.params.id) && await users.countEnabledAdmins() <= 1) {
        return res.status(409).json({ error: 'Birdie must keep at least one enabled administrator.' });
      }
      await runtime.auth.api.banUser({
        headers: fromNodeHeaders(req.headers),
        body: { userId: req.params.id },
      });
      res.status(204).end();
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/users/:id/unban', async (req, res) => {
    try {
      await runtime.auth.api.unbanUser({
        headers: fromNodeHeaders(req.headers),
        body: { userId: req.params.id },
      });
      res.status(204).end();
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/users/:id/revoke-sessions', async (req, res) => {
    try {
      await runtime.auth.api.revokeUserSessions({
        headers: fromNodeHeaders(req.headers),
        body: { userId: req.params.id },
      });
      res.status(204).end();
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}

function sendError(res: { status: (code: number) => { json: (body: unknown) => void } }, error: unknown): void {
  const candidate = error as { status?: string; statusCode?: number; message?: string };
  const status = typeof candidate.statusCode === 'number' ? candidate.statusCode : candidate.status === 'FORBIDDEN' ? 403 : 400;
  res.status(status).json({ error: candidate.message ?? String(error) });
}
