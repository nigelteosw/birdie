import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import type { BirdieAuth } from './auth.js';

export type BirdieScope = 'birdie:read' | 'birdie:write';

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  scopes: ReadonlySet<BirdieScope>;
  disabled: boolean;
}

export interface PrincipalResolver {
  resolve(req: Request): Promise<AuthenticatedUser | null>;
}

const browserScopes = new Set<BirdieScope>(['birdie:read', 'birdie:write']);

export function createSessionPrincipalResolver(auth: BirdieAuth): PrincipalResolver {
  return {
    async resolve(req) {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      if (!session) return null;
      const user = session.user as typeof session.user & {
        role?: string | string[] | null;
        banned?: boolean | null;
      };
      const roles = Array.isArray(user.role) ? user.role : String(user.role ?? 'user').split(',');
      return {
        id: user.id,
        name: user.name || user.email,
        email: user.email,
        role: roles.includes('admin') ? 'admin' : 'user',
        scopes: browserScopes,
        disabled: user.banned === true,
      };
    },
  };
}

export function requirePrincipal(resolver: PrincipalResolver): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await resolver.resolve(req);
      if (!user || user.disabled) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      req.user = user;
      next();
    } catch {
      res.status(401).json({ error: 'Authentication required' });
    }
  };
}

export function requireScope(scope: BirdieScope): RequestHandler {
  return (req, res, next) => {
    if (!req.user?.scopes.has(scope)) {
      res.status(403).json({ error: `Missing required scope: ${scope}` });
      return;
    }
    next();
  };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Administrator access required' });
    return;
  }
  next();
}
