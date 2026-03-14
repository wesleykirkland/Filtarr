import {
  type Request,
  type Response,
  type NextFunction,
  type RequestHandler,
  Router,
} from 'express';
import session from 'express-session';
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type Database from 'better-sqlite3';
import type { AuthConfig, AuthMode } from '../../config/auth.js';
import { getConfig } from '../../config/index.js';
import type { User } from '../../db/schemas/users.js';
import { apiKeyMiddleware } from './apiKey.js';

/**
 * Get the current auth mode from the database settings.
 * This is called on each request to support dynamic auth mode changes (e.g., after setup).
 */
function getCurrentAuthMode(db: Database.Database): AuthMode {
  try {
    const result = db
      .prepare<[], { value: string }>(`SELECT value FROM settings WHERE key = 'auth_mode'`)
      .get();
    return (result?.value as AuthMode) || 'none';
  } catch {
    return 'none';
  }
}

declare global {
  namespace Express {
    interface User {
      id: number;
      username: string;
      displayName: string | null;
    }
  }
}

/**
 * Check if the request is authenticated via any method:
 * 1. API key (req.apiKey set by apiKeyMiddleware)
 * 2. Session (req.isAuthenticated() from passport)
 * 3. Basic auth header
 *
 * Note: Auth mode is read dynamically from the database on each request
 * to support hot-reloading after setup completion.
 */
function requireAuth(db: Database.Database) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Dynamically get auth mode from database (supports setup completion without restart)
    const authMode = getCurrentAuthMode(db);

    // Auth mode "none" — allow all requests
    if (authMode === 'none') {
      next();
      return;
    }

    // API key auth always works regardless of mode
    if (req.apiKey) {
      next();
      return;
    }

    // Session-based auth (forms or oidc)
    if ((authMode === 'forms' || authMode === 'oidc') && req.isAuthenticated?.()) {
      next();
      return;
    }

    // Basic auth
    if (authMode === 'basic') {
      if ((req as any)._basicAuthValid) {
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

/**
 * Basic auth validation middleware.
 * Validates Authorization: Basic <base64> header against credentials from database.
 */
function basicAuthMiddleware(db: Database.Database) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Basic ')) {
      next();
      return;
    }

    try {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
      const colonIndex = decoded.indexOf(':');
      if (colonIndex === -1) {
        next();
        return;
      }

      const providedUser = decoded.substring(0, colonIndex);
      const providedPass = decoded.substring(colonIndex + 1);

      // Look up user in database
      const user = db
        .prepare<
          [string],
          { username: string; password_hash: string }
        >('SELECT username, password_hash FROM users WHERE username = ?')
        .get(providedUser);

      if (user && (await bcrypt.compare(providedPass, user.password_hash))) {
        (req as any)._basicAuthValid = true;
      }
    } catch {
      // Invalid base64 or other error — just continue
    }
    next();
  };
}

/**
 * Configure session middleware for forms-based auth.
 *
 * Security: Uses try/catch to avoid TOCTOU (Time-of-Check-Time-of-Use) race condition
 * instead of checking file existence before reading.
 */
export function getOrCreateSessionSecret(config: AuthConfig): string {
  if (config.forms?.sessionSecret) return config.forms.sessionSecret;

  const secretPath = join(getConfig().dataDir, '.session-secret');

  // Try to read existing secret first (avoids race condition)
  try {
    return readFileSync(secretPath, 'utf-8').trim();
  } catch (err) {
    // File doesn't exist or can't be read, create new secret
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err; // Re-throw if it's not a "file not found" error
    }
  }

  // Create new secret
  const secret = crypto.randomBytes(48).toString('hex');
  mkdirSync(dirname(secretPath), { recursive: true });
  writeFileSync(secretPath, secret, { mode: 0o600 });
  return secret;
}

function sessionMiddleware(config: AuthConfig): RequestHandler {
  const secret = getOrCreateSessionSecret(config);

  return session({
    name: config.forms?.cookieName || 'filtarr.sid',
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
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
        const user = db
          .prepare<[string], User>('SELECT * FROM users WHERE username = ?')
          .get(username);

        if (!user) {
          return done(null, false, { message: 'Invalid credentials' });
        }

        // Check account lockout
        if (user.locked_until && new Date(user.locked_until) > new Date()) {
          return done(null, false, { message: 'Account temporarily locked' });
        }

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
          // Increment failed attempts
          const newAttempts = user.failed_attempts + 1;
          const lockUntil =
            newAttempts >= 5
              ? new Date(Date.now() + 15 * 60 * 1000).toISOString() // Lock 15 min
              : null;

          db.prepare(
            "UPDATE users SET failed_attempts = ?, locked_until = ?, updated_at = datetime('now') WHERE id = ?",
          ).run(newAttempts, lockUntil, user.id);

          return done(null, false, { message: 'Invalid credentials' });
        }

        // Reset failed attempts on success
        db.prepare(
          "UPDATE users SET failed_attempts = 0, locked_until = NULL, updated_at = datetime('now') WHERE id = ?",
        ).run(user.id);

        return done(null, { id: user.id, username: user.username, displayName: user.display_name });
      } catch (err) {
        return done(err);
      }
    }),
  );

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
 * a server restart.
 */
export function createAuthMiddleware(
  db: Database.Database,
  config: AuthConfig,
): { authRouter: Router; requireAuth: RequestHandler } {
  const router = Router();

  // Always apply API key middleware first (works in all modes)
  router.use(apiKeyMiddleware(db));

  // Always apply basic auth middleware (validates if Authorization header present)
  router.use(basicAuthMiddleware(db));

  // Always apply session middleware for forms/oidc auth support
  // This is needed so that sessions work after setup completion with forms mode
  router.use(sessionMiddleware(config));
  configurePassportLocal(db);
  router.use(passport.initialize());
  router.use(passport.session());

  // The requireAuth middleware checks if the request is authenticated
  // It dynamically reads auth mode from DB to support setup completion without restart
  const authCheck = requireAuth(db);

  return { authRouter: router, requireAuth: authCheck };
}
