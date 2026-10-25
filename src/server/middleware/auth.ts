import {
  type Request,
  type Response,
  type NextFunction,
  type RequestHandler,
  Router,
} from 'express';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type Database from 'better-sqlite3';
import { defaultCookieSecure, type AuthConfig, type AuthMode } from '../../config/auth.js';
import { getAuthMode, needsSetup } from '../lib/authMode.js';
import { getConfig } from '../../config/index.js';
import type { User } from '../../db/schemas/users.js';
import { logger } from '../lib/logger.js';
import { apiKeyMiddleware } from './apiKey.js';
import { SqliteSessionStore } from '../lib/sessionStore.js';

// Passport types `req.user` as the global `Express.User` interface, so it can only be extended
// through global namespace merging (module augmentation of express-serve-static-core does not
// reach it). Same pattern as middleware/apiKey.ts.
/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace Express {
    interface User {
      id: number;
      username: string;
      displayName: string | null;
    }
    interface Request {
      /** Set by basicAuthMiddleware when valid Basic credentials were presented in basic mode. */
      _basicAuthValid?: boolean;
    }
  }
}
/* eslint-enable @typescript-eslint/no-namespace */

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

/**
 * bcrypt hash (cost 12, same as stored passwords) of a random value no user can have, generated
 * once per process. Compared against when the username is unknown, the account is locked, or the
 * stored hash is unusable, so every credential failure costs one bcrypt comparison and failures
 * are not distinguishable by timing.
 */
let dummyPasswordHashPromise: Promise<string> | null = null;

function getDummyPasswordHash(): Promise<string> {
  dummyPasswordHashPromise ??= bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
  return dummyPasswordHashPromise;
}

/** The only message ever returned to clients for a failed credential check. */
export const GENERIC_AUTH_FAILURE_MESSAGE = 'Invalid credentials';

export type CredentialFailureReason = 'invalid' | 'locked' | 'unknown_user';

export type CredentialCheckResult =
  | { ok: true; user: User }
  | { ok: false; reason: CredentialFailureReason };

async function dummyCompare(password: string): Promise<void> {
  try {
    await bcrypt.compare(password, await getDummyPasswordHash());
  } catch {
    // Timing equalisation only; the result is irrelevant.
  }
}

/**
 * Atomically reserve one credential attempt for `userId`.
 *
 * The attempt is counted BEFORE the (slow, async) bcrypt comparison, in a single UPDATE, so
 * parallel attempts cannot act on a stale counter: once MAX_FAILED_ATTEMPTS attempts have been
 * reserved the account is locked and further attempts are refused without a comparison. An
 * expired lock restarts the count at 1. A successful comparison resets the counter.
 *
 * Returns false when the account is currently locked.
 */
function reserveCredentialAttempt(db: Database.Database, userId: number): boolean {
  const row = db
    .prepare<[number, number], { failed_attempts: number }>(
      `UPDATE users SET
         failed_attempts = CASE WHEN locked_until IS NOT NULL THEN 1 ELSE failed_attempts + 1 END,
         locked_until = CASE
           WHEN (CASE WHEN locked_until IS NOT NULL THEN 1 ELSE failed_attempts + 1 END) >= ?
             THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+${LOCKOUT_MINUTES} minutes')
           ELSE NULL
         END,
         updated_at = datetime('now')
       WHERE id = ?
         AND (locked_until IS NULL OR julianday(locked_until) <= julianday('now'))
       RETURNING failed_attempts`,
    )
    .get(MAX_FAILED_ATTEMPTS, userId);
  return row !== undefined;
}

/** Clear the failed-attempt counter and any lock for `userId`. */
export function resetFailedAttempts(db: Database.Database, userId: number): void {
  db.prepare(
    "UPDATE users SET failed_attempts = 0, locked_until = NULL, updated_at = datetime('now') WHERE id = ?",
  ).run(userId);
}

/**
 * Verify a username/password against the users table, enforcing account lockout.
 * Shared by the passport local strategy (forms), the Basic auth middleware and the password
 * change endpoint so all of them count failures and honor locks identically.
 *
 * The returned `reason` is for server-side logging only; callers must answer clients with
 * GENERIC_AUTH_FAILURE_MESSAGE regardless of it.
 */
export async function verifyUserCredentials(
  db: Database.Database,
  username: string,
  password: string,
): Promise<CredentialCheckResult> {
  const user = db.prepare<[string], User>('SELECT * FROM users WHERE username = ?').get(username);

  if (!user) {
    await dummyCompare(password);
    return { ok: false, reason: 'unknown_user' };
  }

  if (!reserveCredentialAttempt(db, user.id)) {
    await dummyCompare(password);
    return { ok: false, reason: 'locked' };
  }

  let valid = false;
  if (user.password_hash) {
    valid = await bcrypt.compare(password, user.password_hash);
  } else {
    await dummyCompare(password);
  }

  if (!valid) {
    return { ok: false, reason: 'invalid' };
  }

  resetFailedAttempts(db, user.id);
  return { ok: true, user };
}

export function logCredentialFailure(
  source: 'forms' | 'basic' | 'password-change',
  username: string,
  reason: CredentialFailureReason,
): void {
  logger.warn({ source, username, reason }, 'Authentication failed');
}

/**
 * Sessions are only honored in forms mode. (No OIDC strategy ships in this build, so a session
 * presented in any other mode is a leftover from before an auth-mode change.)
 * Shared by requireAuth and the auth routes so both apply the same rule.
 */
export function isSessionAuthenticated(req: Request, authMode: AuthMode): boolean {
  return authMode === 'forms' && Boolean(req.isAuthenticated?.());
}

/**
 * Check if the request is authenticated via any method:
 * 1. API key (req.apiKey set by apiKeyMiddleware)
 * 2. Session (req.isAuthenticated() from passport) — forms mode only
 * 3. Basic auth header — basic mode only
 *
 * Note: Auth mode is read dynamically from the database on each request
 * to support hot-reloading after setup completion.
 */
export function requireAuth(db: Database.Database) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Dynamically get auth mode from database (supports setup completion without restart).
    // SECURITY: fail closed — an unreadable auth mode must never be treated as "none".
    let authMode: AuthMode;
    let setupPending: boolean;
    try {
      setupPending = needsSetup(db);
      authMode = getAuthMode(db);
    } catch {
      res.status(503).json({ error: 'Authentication unavailable' });
      return;
    }

    // Until setup completes there are no credentials; nothing protected is reachable.
    if (setupPending) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Auth mode "none" — allow all requests
    if (authMode === 'none') {
      next();
      return;
    }

    // API key auth works in every mode (scopes are enforced by scopedRouter/requireScope)
    if (req.apiKey) {
      next();
      return;
    }

    if (isSessionAuthenticated(req, authMode)) {
      next();
      return;
    }

    // Basic auth
    if (authMode === 'basic') {
      if (req._basicAuthValid) {
        next();
        return;
      }
      // Return 401 with WWW-Authenticate header for browser native prompt
      res.setHeader('WWW-Authenticate', 'Basic realm="Filtarr"');
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    res.status(401).json({ error: 'Authentication required' });
  };
}

function hasBasicAuthHeader(req: Request): boolean {
  return /^basic /i.test(req.headers.authorization ?? '');
}

/**
 * Per-IP limiter for requests carrying Basic credentials. Only failed credential checks count
 * toward the limit (a browser in basic mode resends the header on every request), so the
 * effective budget matches the login endpoint's `rateLimitAuth` attempts per minute.
 */
function basicAuthRateLimiter(maxFailures: number): RequestHandler {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: maxFailures,
    skipSuccessfulRequests: true,
    requestWasSuccessful: (req: Request) => Boolean(req._basicAuthValid),
    message: { error: 'Too many authentication attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  });
}

/**
 * Basic auth validation middleware.
 * Validates Authorization: Basic <base64> header against credentials from database.
 * Only active in basic mode; the header is ignored in every other mode.
 */
function basicAuthMiddleware(db: Database.Database, maxFailuresPerMinute: number) {
  const limiter = basicAuthRateLimiter(maxFailuresPerMinute);

  const validate = async (req: Request, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers.authorization ?? '';
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
      const colonIndex = decoded.indexOf(':');
      if (colonIndex === -1) {
        next();
        return;
      }

      const providedUser = decoded.substring(0, colonIndex);
      const providedPass = decoded.substring(colonIndex + 1);

      // Verify against the database (applies the same lockout as forms login)
      const result = await verifyUserCredentials(db, providedUser, providedPass);
      if (result.ok) {
        req._basicAuthValid = true;
      } else {
        logCredentialFailure('basic', providedUser, result.reason);
      }
    } catch (err) {
      logger.error({ err }, 'Basic auth validation error');
    }
    next();
  };

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!hasBasicAuthHeader(req) || getAuthMode(db) !== 'basic') {
      next();
      return;
    }
    void limiter(req, res, (err?: unknown) => {
      if (err) {
        next(err);
        return;
      }
      void validate(req, next);
    });
  };
}

/**
 * Configure session middleware for forms-based auth.
 */
export function getOrCreateSessionSecret(config: AuthConfig): string {
  if (config.forms?.sessionSecret) return config.forms.sessionSecret;

  const secretPath = join(getConfig().dataDir, '.session-secret');

  try {
    return readFileSync(secretPath, 'utf-8').trim();
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const secret = crypto.randomBytes(48).toString('hex');
  mkdirSync(dirname(secretPath), { recursive: true });
  writeFileSync(secretPath, secret, { mode: 0o600 });
  return secret;
}

/** Every session store created by this process, so all sessions can be invalidated at once. */
const sessionStores = new Set<session.Store>();

/**
 * Destroy every server-side session (all users, all devices). Call after a password change or
 * an auth-mode change so existing session cookies stop working.
 */
export async function invalidateAllSessions(): Promise<void> {
  const results = await Promise.allSettled(
    [...sessionStores].map(
      (store) =>
        new Promise<void>((resolve, reject) => {
          if (!store.clear) {
            resolve();
            return;
          }
          store.clear((err?: unknown) => (err ? reject(err) : resolve()));
        }),
    ),
  );
  // A store whose database has been closed (e.g. a previous app instance) can no longer hold
  // live sessions; drop it instead of failing the caller.
  [...sessionStores].forEach((store, index) => {
    if (results[index]?.status === 'rejected') sessionStores.delete(store);
  });
}

function sessionMiddleware(config: AuthConfig, db: Database.Database): RequestHandler {
  const secret = getOrCreateSessionSecret(config);
  // Persist sessions in SQLite so logins survive restarts (MemoryStore also leaks).
  const store = new SqliteSessionStore(db);
  sessionStores.add(store);

  return session({
    name: config.forms?.cookieName || 'filtarr.sid',
    secret,
    store,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // FILTARR_COOKIE_SECURE overrides; default is Secure in production only.
      // Behind a TLS-terminating proxy, set FILTARR_TRUST_PROXY so req.secure is detected.
      secure: config.cookieSecure ?? defaultCookieSecure(),
      sameSite: 'strict',
      maxAge: config.forms?.sessionMaxAge || 86400000,
    },
  });
}

/**
 * Configure passport with local strategy for forms auth.
 */
function configurePassportLocal(db: Database.Database): void {
  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const result = await verifyUserCredentials(db, username, password);
        if (!result.ok) {
          logCredentialFailure('forms', username, result.reason);
          return done(null, false, { message: GENERIC_AUTH_FAILURE_MESSAGE });
        }

        const { user } = result;
        return done(null, { id: user.id, username: user.username, displayName: user.display_name });
      } catch (err) {
        return done(err);
      }
    }),
  );

  // passport keeps a global, append-only list of (de)serializers. Replace rather than append so
  // a re-created app (tests, or a future in-process restart) never runs a stale closure first.
  const registry = passport as unknown as { _serializers?: unknown[]; _deserializers?: unknown[] };
  registry._serializers = [];
  registry._deserializers = [];
  passport.serializeUser((user, done) => done(null, user.id));

  passport.deserializeUser((id: number, done) => {
    const user = db.prepare<[number], User>('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) return done(null, false);
    done(null, { id: user.id, username: user.username, displayName: user.display_name });
  });
}

/**
 * Auth middleware factory.
 * Creates a Router with all necessary auth middleware applied at the router level.
 * This ensures ALL routes mounted under this router require authentication.
 *
 * SECURITY: Auth is applied at the Router level, not per-route.
 * This prevents accidentally exposing endpoints (Huntarr vulnerability).
 *
 * Note: All auth middlewares are always configured so that the auth mode
 * can be changed dynamically (e.g., after setup completion) without requiring
 * a server restart. Each one checks the current mode per request.
 */
export function createAuthMiddleware(
  db: Database.Database,
  config: AuthConfig,
): { authRouter: Router; requireAuth: RequestHandler } {
  const router = Router();

  // Always apply API key middleware first (works in all modes)
  router.use(apiKeyMiddleware(db));

  // Basic auth: only validates (and rate limits) when the current mode is basic
  router.use(basicAuthMiddleware(db, config.rateLimitAuth));

  // Always apply session middleware for forms auth support
  // This is needed so that sessions work after setup completion with forms mode
  router.use(sessionMiddleware(config, db));
  configurePassportLocal(db);
  router.use(passport.initialize());
  router.use(passport.session());

  // The requireAuth middleware checks if the request is authenticated
  // It dynamically reads auth mode from DB to support setup completion without restart
  const authCheck = requireAuth(db);

  return { authRouter: router, requireAuth: authCheck };
}
