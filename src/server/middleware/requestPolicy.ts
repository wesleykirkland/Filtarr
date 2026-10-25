import type { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit from 'express-rate-limit';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SAME_ORIGIN_FETCH_SITES = new Set(['same-origin', 'none']);

function isMutating(req: Request): boolean {
  return MUTATING_METHODS.has(req.method.toUpperCase());
}

function hasBody(req: Request): boolean {
  if (req.headers['transfer-encoding'] !== undefined) return true;
  const length = req.headers['content-length'];
  return length !== undefined && Number(length) > 0;
}

/**
 * Reject mutating API requests whose body is not JSON (HTTP 415).
 * The client only ever sends JSON, and refusing form-encoded / text bodies
 * means a cross-site HTML form cannot produce a body the API will accept.
 * Mount on '/api'. Requests without a body are allowed.
 */
export function requireJsonBody(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isMutating(req) || !hasBody(req)) {
      next();
      return;
    }
    if (req.is(['application/json', '+json'])) {
      next();
      return;
    }
    res.status(415).json({ error: 'Unsupported Media Type: request body must be application/json' });
  };
}

function parseUrl(value: string | undefined): URL | null {
  if (!value || value === 'null') return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * Reject cross-site mutating API requests that rely on ambient credentials
 * (session cookies or browser-cached Basic auth). Requests carrying an
 * `x-api-key` header are exempt: a cross-site page cannot set that header
 * without a CORS preflight.
 *
 * A request is allowed when:
 * - `Sec-Fetch-Site` is `same-origin` or `none`, or
 * - its `Origin` (or `Referer` when Origin is missing) matches the request host
 *   or one of `allowedOrigins` (the configured CORS origins), or
 * - it carries none of `Sec-Fetch-Site`, `Origin`, `Referer` (non-browser client).
 *
 * Mount on '/api'.
 */
export function rejectCrossSiteRequests(allowedOrigins: string | string[] = []): RequestHandler {
  const allowed = new Set(
    (Array.isArray(allowedOrigins) ? allowedOrigins : [allowedOrigins])
      .map((origin) => parseUrl(origin)?.origin.toLowerCase())
      .filter((origin): origin is string => typeof origin === 'string'),
  );

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isMutating(req) || req.get('x-api-key')) {
      next();
      return;
    }

    const fetchSite = req.get('sec-fetch-site')?.toLowerCase();
    if (fetchSite && SAME_ORIGIN_FETCH_SITES.has(fetchSite)) {
      next();
      return;
    }

    const source = req.get('origin') ?? req.get('referer');
    if (!fetchSite && source === undefined) {
      // No browser provenance headers at all: not a browser-initiated cross-site request.
      next();
      return;
    }

    const sourceUrl = parseUrl(source);
    if (sourceUrl) {
      const requestHosts = [req.get('host'), req.host]
        .filter((host): host is string => typeof host === 'string' && host.length > 0)
        .map((host) => host.toLowerCase());
      if (
        requestHosts.includes(sourceUrl.host.toLowerCase()) ||
        allowed.has(sourceUrl.origin.toLowerCase())
      ) {
        next();
        return;
      }
    }

    res.status(403).json({ error: 'Cross-site request rejected' });
  };
}

/**
 * Prevent browsers and intermediaries from caching API responses.
 * Mount on '/api'.
 */
export function noStoreApiResponses(): RequestHandler {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    next();
  };
}

/** POST endpoints that make outbound calls or perform heavy/privileged work. */
export const SENSITIVE_ACTION_PATHS = [
  '/api/v1/instances/test',
  '/api/v1/instances/:id/test',
  '/api/v1/settings/notifications/test',
  '/api/v1/settings/backup/create',
  '/api/v1/settings/backup/import',
  '/api/v1/auth/api-keys',
  '/api/v1/auth/api-keys/rotate',
];

/**
 * Strict rate limiter for expensive or sensitive actions.
 * 10 requests per minute per IP, shared across all sensitive endpoints.
 * Keyed on req.ip (honors 'trust proxy' only when configured).
 */
/**
 * Router-level limiter for routers whose handlers touch the filesystem or do expensive work
 * (settings, system). Generous enough for normal UI use; the global and sensitive-action
 * limiters still apply on top. Lives in the router chain so static analysis can see it.
 */
export function routerRateLimiter(maxRequests: number = 120): RequestHandler {
  return rateLimit({
    windowMs: 60 * 1000,
    max: maxRequests,
    message: { error: 'Too many requests. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  });
}

export function sensitiveActionLimiter(maxRequests: number = 10): RequestHandler {
  return rateLimit({
    windowMs: 60 * 1000,
    max: maxRequests,
    message: { error: 'Too many requests for this action. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  });
}
