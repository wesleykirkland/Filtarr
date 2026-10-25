import { type RequestHandler, type Express } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
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
        styleSrc: ["'self'"],
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
 *
 * Keyed on req.ip via express-rate-limit's default key generator (IPv6-subnet aware).
 * req.ip only reflects X-Forwarded-For when Express 'trust proxy' is configured
 * (FILTARR_TRUST_PROXY), so clients cannot spoof their key with a forged header.
 */
export function authRateLimiter(maxAttempts: number = 5): RequestHandler {
  return rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: maxAttempts,
    message: { error: 'Too many authentication attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  });
}

/**
 * General API rate limiter.
 * 100 requests per minute per IP (configurable).
 * Keyed on req.ip (see authRateLimiter).
 */
export function generalRateLimiter(maxRequests: number = 100): RequestHandler {
  return rateLimit({
    windowMs: 60 * 1000,
    max: maxRequests,
    message: { error: 'Too many requests. Please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
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
