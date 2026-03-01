import { type RequestHandler, type Express } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import { doubleCsrf } from 'csrf-csrf';
import type { AuthConfig } from '../../config/auth.js';

/**
 * Configure security headers via helmet.
 */
export function helmetMiddleware(): RequestHandler {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false, // Allow loading UI assets
  });
}

/**
 * Rate limiter for authentication endpoints.
 * 5 attempts per minute per IP (configurable).
 */
export function authRateLimiter(maxAttempts: number = 5): RequestHandler {
  return rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: maxAttempts,
    message: { error: 'Too many authentication attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      // Use X-Forwarded-For if behind a reverse proxy, otherwise remote IP
      return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
        || req.socket.remoteAddress
        || 'unknown';
    },
  });
}

/**
 * General API rate limiter.
 * 100 requests per minute per IP (configurable).
 */
export function generalRateLimiter(maxRequests: number = 100): RequestHandler {
  return rateLimit({
    windowMs: 60 * 1000,
    max: maxRequests,
    message: { error: 'Too many requests. Please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
        || req.socket.remoteAddress
        || 'unknown';
    },
  });
}

/**
 * Configure CORS middleware.
 * Default: same-origin only.
 */
export function corsMiddleware(origin: string | string[] = 'same-origin'): RequestHandler {
  if (origin === 'same-origin') {
    // Same-origin: no CORS headers needed (browser enforces same-origin by default)
    return cors({ origin: false });
  }

  return cors({
    origin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Api-Key', 'X-CSRF-Token'],
    maxAge: 600, // 10 minutes
  });
}

/**
 * CSRF protection using the double-submit cookie pattern.
 * Only applied to forms-based auth (session-based).
 * API key requests are exempt (they don't use cookies).
 */
export function csrfMiddleware(cookieSecret: string) {
  const { doubleCsrfProtection, generateCsrfToken } = doubleCsrf({
    getSecret: () => cookieSecret,
    getSessionIdentifier: (req) => req.session?.id || req.socket.remoteAddress || 'anonymous',
    cookieName: 'filtarr.csrf',
    cookieOptions: {
      httpOnly: true,
      sameSite: 'strict' as const,
      secure: process.env['NODE_ENV'] === 'production',
      path: '/',
    },
    getCsrfTokenFromRequest: (req) => {
      return req.headers['x-csrf-token'] || (req.body as Record<string, string>)?.['_csrf'];
    },
  });

  return { csrfProtection: doubleCsrfProtection, generateCsrfToken };
}

/**
 * Apply all security middleware to the Express app.
 */
export function applySecurityMiddleware(app: Express, config: AuthConfig): void {
  // Security headers
  app.use(helmetMiddleware());

  // CORS
  app.use(corsMiddleware(config.corsOrigin));

  // General rate limiting on all API routes
  app.use('/api/', generalRateLimiter(config.rateLimitGeneral));
}

