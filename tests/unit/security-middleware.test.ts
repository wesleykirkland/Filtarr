import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  helmet: vi.fn((options) => ({ kind: 'helmet', options })),
  rateLimit: vi.fn((options) => ({ kind: 'rate-limit', options })),
  cors: vi.fn((options) => ({ kind: 'cors', options })),
}));

vi.mock('helmet', () => ({ default: state.helmet }));
vi.mock('express-rate-limit', () => ({ default: state.rateLimit }));
vi.mock('cors', () => ({ default: state.cors }));

import {
  applySecurityMiddleware,
  authRateLimiter,
  corsMiddleware,
  generalRateLimiter,
  helmetMiddleware,
} from '../../src/server/middleware/security.js';

describe('security middleware factories', () => {
  beforeEach(() => {
    [state.helmet, state.rateLimit, state.cors].forEach((mock) => mock.mockReset());
    state.helmet.mockImplementation((options) => ({ kind: 'helmet', options }));
    state.rateLimit.mockImplementation((options) => ({ kind: 'rate-limit', options }));
    state.cors.mockImplementation((options) => ({ kind: 'cors', options }));
    delete process.env['NODE_ENV'];
  });

  afterEach(() => {
    delete process.env['NODE_ENV'];
    vi.restoreAllMocks();
  });

  it('configures helmet with the expected CSP and COEP settings', () => {
    const middleware = helmetMiddleware();

    expect(middleware).toEqual(expect.objectContaining({ kind: 'helmet' }));
    expect(state.helmet).toHaveBeenCalledWith(
      expect.objectContaining({
        crossOriginEmbedderPolicy: false,
        contentSecurityPolicy: expect.objectContaining({
          directives: expect.objectContaining({
            defaultSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
          }),
        }),
      }),
    );
  });

  it('builds auth and general rate limiters keyed on req.ip rather than raw X-Forwarded-For', () => {
    authRateLimiter(3);
    generalRateLimiter(25);

    const authOptions = state.rateLimit.mock.calls[0][0];
    const generalOptions = state.rateLimit.mock.calls[1][0];

    expect(authOptions.max).toBe(3);
    expect(authOptions.message).toEqual({ error: 'Too many authentication attempts. Please try again later.' });
    // No custom key generator: express-rate-limit defaults to req.ip, which only honors
    // X-Forwarded-For when Express 'trust proxy' is configured.
    expect(authOptions.keyGenerator).toBeUndefined();

    expect(generalOptions.max).toBe(25);
    expect(generalOptions.message).toEqual({ error: 'Too many requests. Please slow down.' });
    expect(generalOptions.keyGenerator).toBeUndefined();
  });

  it('configures same-origin and explicit CORS policies', () => {
    const sameOrigin = corsMiddleware();
    const custom = corsMiddleware(['https://app.example']);

    expect(sameOrigin).toEqual(expect.objectContaining({ kind: 'cors' }));
    expect(state.cors).toHaveBeenNthCalledWith(1, { origin: false });
    expect(state.cors).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        origin: ['https://app.example'],
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Api-Key', 'X-CSRF-Token'],
        maxAge: 600,
      }),
    );
    expect(custom).toEqual(expect.objectContaining({ kind: 'cors' }));
  });

  it('applies helmet, cors, and general API rate limiting to the express app', () => {
    state.helmet.mockReturnValueOnce('helmet-mw');
    state.cors.mockReturnValueOnce('cors-mw');
    state.rateLimit.mockReturnValueOnce('rate-limit-mw');
    const app = { use: vi.fn() };

    applySecurityMiddleware(app as any, { corsOrigin: 'same-origin', rateLimitGeneral: 42 } as any);

    expect(app.use).toHaveBeenNthCalledWith(1, 'helmet-mw');
    expect(app.use).toHaveBeenNthCalledWith(2, 'cors-mw');
    expect(app.use).toHaveBeenNthCalledWith(3, '/api/', 'rate-limit-mw');
  });
});