import type { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger.js';

export interface ApiError extends Error {
  statusCode?: number;
  code?: string;
}

export function errorHandler(
  err: ApiError,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const statusCode = err.statusCode ?? 500;
  const message = statusCode === 500 ? 'Internal Server Error' : err.message;

  if (statusCode === 500) {
    logger.error({ err, path: _req.path, method: _req.method }, 'Unhandled error');
  } else {
    logger.debug({ err, path: _req.path, method: _req.method }, 'API error');
  }

  res.status(statusCode).json({
    error: {
      message,
      code: err.code ?? 'INTERNAL_ERROR',
    },
  });
}
