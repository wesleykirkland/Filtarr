import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  helmet: vi.fn((options) => ({ kind: 'helmet', options })),
  rateLimit: vi.fn((options) => ({ kind: 'rate-limit', options })),
  cors: vi.fn((options) => ({ kind: 'cors', options })),
  csrfProtection: vi.fn(),
  generateCsrfToken: vi.fn(() => 'csrf-token'),
  doubleCsrf: vi.fn(),
}));

vi.mock('helmet', () => ({ default: state.helmet }));
vi.mock('express-rate-limit', () => ({ default: state.rateLimit }));
vi.mock('cors', () => ({ default: state.cors }));
vi.mock('csrf-csrf', () => ({ doubleCsrf: state.doubleCsrf }));

import {
  applySecurityMiddleware,
  authRateLimiter,
  corsMiddleware,
  csrfMiddleware,
  generalRateLimiter,
  helmetMiddleware,
} from '../../src/server/middleware/security.js';

describe('security middleware factories', () => {
  beforeEach(() => {
    [state.helmet, state.rateLimit, state.cors, state.doubleCsrf, state.csrfProtection, state.generateCsrfToken].forEach((mock) => mock.mockReset());
    state.helmet.mockImplementation((options) => ({ kind: 'helmet', options }));
    state.rateLimit.mockImplementation((options) => ({ kind: 'rate-limit', options }));
    state.cors.mockImplementation((options) => ({ kind: 'cors', options }));
    state.generateCsrfToken.mockReturnValue('csrf-token');
    state.doubleCsrf.mockImplementation(() => ({
      doubleCsrfProtection: state.csrfProtection,
      generateCsrfToken: state.generateCsrfToken,
    }));
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

  it('builds auth and general rate limiters with the expected IP keying behavior', () => {
    authRateLimiter(3);
    generalRateLimiter(25);

    const authOptions = state.rateLimit.mock.calls[0][0];
    const generalOptions = state.rateLimit.mock.calls[1][0];
    const forwardedReq = { headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }, socket: { remoteAddress: '3.3.3.3' } };

    expect(authOptions.max).toBe(3);
    expect(authOptions.message).toEqual({ error: 'Too many authentication attempts. Please try again later.' });
    expect(authOptions.keyGenerator(forwardedReq as any)).toBe('1.1.1.1');
    expect(authOptions.keyGenerator({ headers: {}, socket: { remoteAddress: '4.4.4.4' } } as any)).toBe('4.4.4.4');
    expect(authOptions.keyGenerator({ headers: {}, socket: {} } as any)).toBe('unknown');

    expect(generalOptions.max).toBe(25);
    expect(generalOptions.message).toEqual({ error: 'Too many requests. Please slow down.' });
    expect(generalOptions.keyGenerator(forwardedReq as any)).toBe('1.1.1.1');
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

  it('creates CSRF middleware with session and request token helpers', () => {
    process.env['NODE_ENV'] = 'production';

    const csrf = csrfMiddleware('cookie-secret');
    const options = state.doubleCsrf.mock.calls[0][0];

    expect(options.getSecret()).toBe('cookie-secret');
    expect(options.getSessionIdentifier({ session: { id: 'session-1' }, socket: { remoteAddress: '5.5.5.5' } } as any)).toBe('session-1');
    expect(options.getSessionIdentifier({ socket: { remoteAddress: '5.5.5.5' } } as any)).toBe('5.5.5.5');
    expect(options.getSessionIdentifier({ socket: {} } as any)).toBe('anonymous');
    expect(options.cookieOptions).toEqual(
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'strict',
        secure: true,
        path: '/',
      }),
    );
    expect(options.getCsrfTokenFromRequest({ headers: { 'x-csrf-token': 'header-token' }, body: { _csrf: 'body-token' } } as any)).toBe('header-token');
    expect(options.getCsrfTokenFromRequest({ headers: {}, body: { _csrf: 'body-token' } } as any)).toBe('body-token');
    expect(csrf).toEqual({ csrfProtection: state.csrfProtection, generateCsrfToken: state.generateCsrfToken });
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