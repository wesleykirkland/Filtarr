import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { SecurityPolicyError } from '../../services/security.js';

/**
 * Parse an integer route parameter. Responds with 400 and returns null when it is
 * not a number, so callers can simply `return` on null.
 */
export function parseIdParam(req: Request, res: Response, name = 'id'): number | null {
  const id = Number.parseInt((req.params[name] as string) || '', 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Invalid ID' });
    return null;
  }
  return id;
}

export interface RouteErrorOptions {
  /** Message returned with 409 when a UNIQUE constraint fails. */
  conflictMessage: string;
  /** Map errors whose message contains "not found" to 404. */
  notFound?: boolean;
}

/**
 * Map the errors the CRUD routers share to JSON responses: zod validation (400),
 * security policy (403), optional "not found" (404) and UNIQUE violations (409).
 * Anything else is passed to the error handler.
 */
export function sendRouteError(
  err: unknown,
  res: Response,
  next: NextFunction,
  options: RouteErrorOptions,
): void {
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: err.issues[0]?.message || 'Invalid input' });
    return;
  }
  if (err instanceof SecurityPolicyError) {
    res.status(403).json({ error: err.message });
    return;
  }
  if (err instanceof Error) {
    if (options.notFound && err.message.includes('not found')) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err.message.includes('UNIQUE constraint failed')) {
      res.status(409).json({ error: options.conflictMessage });
      return;
    }
  }
  next(err);
}
