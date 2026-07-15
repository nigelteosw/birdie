import type { AuthenticatedUser } from './authPrincipal.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export {};
