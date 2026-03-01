import { type Request, type Response, type NextFunction, type RequestHandler, Router } from 'express';
import session from 'express-session';
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AuthConfig, AuthMode } from '../../config/auth.js';
import type { User } from '../../db/schemas/users.js';
import { apiKeyMiddleware } from './apiKey.js';

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
 */
function requireAuth(authMode: AuthMode) {
  return (req: Request, res: Response, next: NextFunction): void => {
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
    if (authMode === 'basic' && req.headers.authorization?.startsWith('Basic ')) {
      // Basic auth is validated in the apiKey middleware chain; if we get here
      // it means basic auth was already validated
      if ((req as any)._basicAuthValid) {
        next();
        return;
      }
    }

    res.status(401).json({ error: 'Authentication required' });
  };
}

/**
 * Basic auth validation middleware.
 * Validates Authorization: Basic <base64> header against configured credentials.
 */
function basicAuthMiddleware(username: string, passwordHash: string) {
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

      if (providedUser === username && await bcrypt.compare(providedPass, passwordHash)) {
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
 */
function sessionMiddleware(config: AuthConfig): RequestHandler {
  const secret = config.forms?.sessionSecret || crypto.randomBytes(32).toString('hex');

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
  passport.use(new LocalStrategy(async (username, password, done) => {
    try {
      const user = db.prepare<[string], User>(
        'SELECT * FROM users WHERE username = ?',
      ).get(username);

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
        const lockUntil = newAttempts >= 5
          ? new Date(Date.now() + 15 * 60 * 1000).toISOString() // Lock 15 min
          : null;

        db.prepare(
          'UPDATE users SET failed_attempts = ?, locked_until = ?, updated_at = datetime(\'now\') WHERE id = ?',
        ).run(newAttempts, lockUntil, user.id);

        return done(null, false, { message: 'Invalid credentials' });
      }

      // Reset failed attempts on success
      db.prepare(
        'UPDATE users SET failed_attempts = 0, locked_until = NULL, updated_at = datetime(\'now\') WHERE id = ?',
      ).run(user.id);

      return done(null, { id: user.id, username: user.username, displayName: user.display_name });
    } catch (err) {
      return done(err);
    }
  }));

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
 */
export function createAuthMiddleware(
  db: Database.Database,
  config: AuthConfig,
): { authRouter: Router; requireAuth: RequestHandler } {
  const router = Router();

  // Always apply API key middleware first (works in all modes)
  router.use(apiKeyMiddleware(db));

  // Mode-specific middleware
  switch (config.mode) {
    case 'basic': {
      if (!config.basic) {
        throw new Error('Basic auth config required when mode is "basic"');
      }
      // Hash the configured password for comparison
      const passwordHash = bcrypt.hashSync(config.basic.password, 12);
      router.use(basicAuthMiddleware(config.basic.username, passwordHash));
      break;
    }

    case 'forms': {
      router.use(sessionMiddleware(config));
      configurePassportLocal(db);
      router.use(passport.initialize());
      router.use(passport.session());
      break;
    }

    case 'oidc': {
      if (!config.oidc) {
        throw new Error('OIDC config required when mode is "oidc"');
      }
      // OIDC uses sessions too
      router.use(sessionMiddleware(config));
      router.use(passport.initialize());
      router.use(passport.session());
      // Note: OIDC strategy is configured in auth routes
      break;
    }

    case 'none':
    default:
      // No additional middleware needed
      break;
  }

  // The requireAuth middleware checks if the request is authenticated
  const authCheck = requireAuth(config.mode);

  return { authRouter: router, requireAuth: authCheck };
}

