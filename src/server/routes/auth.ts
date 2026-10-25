import { Router, type Request, type Response, type NextFunction } from 'express';
import passport from 'passport';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import type { AuthConfig } from '../../config/auth.js';
import { getAuthMode } from '../lib/authMode.js';
import { destroyAllSessions } from '../lib/sessionStore.js';
import { requireAuth } from '../middleware/auth.js';
import { authRateLimiter } from '../middleware/security.js';
import {
  API_KEY_SCOPES,
  DEFAULT_API_KEY_SCOPES,
  generateApiKey,
  hashApiKey,
  getKeyIdentifiers,
  hasScope,
  requireScope,
} from '../middleware/apiKey.js';
import {
  invalidateAllSessions,
  isSessionAuthenticated,
  logCredentialFailure,
  verifyUserCredentials,
} from '../middleware/auth.js';
import { type ApiKey, toApiKeyResponse } from '../../db/schemas/users.js';

const PASSWORD_BCRYPT_ROUNDS = 12;

const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(100).default('API Key'),
  scopes: z
    .array(z.enum(API_KEY_SCOPES))
    .min(1, 'At least one scope is required')
    .default([...DEFAULT_API_KEY_SCOPES]),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'currentPassword is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters').max(1024),
});

/**
 * An API key without `admin` may only rotate or revoke itself.
 * Returns false (and sends 403) when the caller may not act on `targetKeyId`.
 */
function checkKeyOwnership(req: Request, res: Response, targetKeyId: number): boolean {
  if (req.apiKey && !hasScope(req.apiKey.scopes, 'admin') && req.apiKey.apiKeyId !== targetKeyId) {
    res.status(403).json({ error: "API keys without the 'admin' scope can only manage themselves" });
    return false;
  }
  return true;
}

function parseKeyId(raw: unknown): number | null {
  const id = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function hasOidcStrategy(): boolean {
  const passportWithStrategy = passport as unknown as { _strategy?: (name: string) => unknown };

  return typeof passportWithStrategy._strategy === 'function'
    ? Boolean(passportWithStrategy._strategy('openidconnect'))
    : false;
}

/**
 * Create auth routes for login, logout, session, and API key management.
 * Rate limiting (5 attempts/min by default) is applied to the login endpoint only.
 */
export function createAuthRoutes(db: Database.Database, config: AuthConfig): Router {
  const router = Router();

  // Rate limit credential submission only — not session polling or API key management
  const loginLimiter = authRateLimiter(config.rateLimitAuth);

  const handleOidcLogin = (req: Request, res: Response, next: NextFunction): void => {
    if (!hasOidcStrategy()) {
      res.status(503).json({ error: 'OIDC strategy is not configured in this build' });
      return;
    }

    passport.authenticate('openidconnect')(req, res, next);
  };

  const handleLogin = (req: Request, res: Response, next: NextFunction): void => {
    // Get current auth mode dynamically from database
    const authMode = getAuthMode(db);

    if (authMode === 'none') {
      res.json({ success: true, message: 'Auth disabled' });
      return;
    }

    if (authMode === 'basic') {
      // Basic auth doesn't use login endpoint — it's header-based
      res.status(400).json({ error: 'Basic auth uses Authorization header, not login endpoint' });
      return;
    }

    if (authMode === 'forms') {
      passport.authenticate(
        'local',
        (err: Error | null, user: Express.User | false, info: { message: string }) => {
          if (err) return next(err);
          if (!user) {
            // info.message is always the generic failure message (see configurePassportLocal)
            res.status(401).json({ error: info?.message || 'Invalid credentials' });
            return;
          }
          req.logIn(user, (loginErr) => {
            if (loginErr) return next(loginErr);
            // Never return sensitive data
            res.json({
              success: true,
              user: { id: user.id, username: user.username, displayName: user.displayName },
            });
          });
        },
      )(req, res, next);
      return;
    }

    if (authMode === 'oidc') {
      // OIDC login redirects to the identity provider
      handleOidcLogin(req, res, next);
      return;
    }

    res.status(400).json({ error: 'Unknown auth mode' });
  };

  // --- Login ---
  // Credentials must be POSTed. GET is only meaningful for the OIDC redirect flow; for every
  // other mode it is rejected so credentials are never accepted from the query string.
  router.get('/login', loginLimiter, (req: Request, res: Response, next: NextFunction): void => {
    if (getAuthMode(db) === 'oidc') {
      handleOidcLogin(req, res, next);
      return;
    }
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed. Use POST to log in.' });
  });
  router.post('/login', loginLimiter, handleLogin);

  // --- Logout ---
  router.post('/logout', (req: Request, res: Response, next: NextFunction): void => {
    if (req.session) {
      req.session.destroy((err) => {
        if (err) return next(err);
        res.clearCookie(config.forms?.cookieName || 'filtarr.sid');
        res.json({ success: true });
      });
    } else {
      res.json({ success: true });
    }
  });

  // --- Session info ---
  router.get('/session', (req: Request, res: Response): void => {
    // Get current auth mode dynamically from database
    const authMode = getAuthMode(db);

    if (authMode === 'none') {
      res.json({ authenticated: true, mode: 'none' });
      return;
    }

    if (req.apiKey) {
      res.json({
        authenticated: true,
        mode: 'apikey',
        apiKey: { id: req.apiKey.apiKeyId, name: req.apiKey.apiKeyName },
      });
      return;
    }

    // Check basic auth
    if (authMode === 'basic' && req._basicAuthValid) {
      res.json({
        authenticated: true,
        mode: 'basic',
      });
      return;
    }

    if (isSessionAuthenticated(req, authMode) && req.user) {
      res.json({
        authenticated: true,
        mode: authMode,
        user: { id: req.user.id, username: req.user.username, displayName: req.user.displayName },
      });
      return;
    }

    res.json({ authenticated: false, mode: authMode });
  });

  // --- OIDC callback ---
  router.get('/oidc/callback', (req: Request, res: Response): void => {
    if (getAuthMode(db) !== 'oidc') {
      res.status(404).json({ error: 'OIDC authentication is not enabled' });
      return;
    }

    if (!hasOidcStrategy()) {
      res.status(503).json({ error: 'OIDC strategy is not configured in this build' });
      return;
    }

    passport.authenticate('openidconnect', { failureRedirect: '/login' })(req, res, () => {
      res.redirect('/');
    });
  });

  // --- Password change ---
  // Session (forms) users only: API keys and Basic credentials cannot change the password.
  router.put(
    '/password',
    loginLimiter,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const authMode = getAuthMode(db);
        if (req.apiKey || !isSessionAuthenticated(req, authMode) || !req.user) {
          res.status(401).json({ error: 'Password changes require a logged-in session' });
          return;
        }

        const parsed = changePasswordSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
          return;
        }
        const { currentPassword, newPassword } = parsed.data;
        const sessionUser = req.user;

        const check = await verifyUserCredentials(db, sessionUser.username, currentPassword);
        if (!check.ok) {
          logCredentialFailure('password-change', sessionUser.username, check.reason);
          // 403, not 401: the session is still valid, only the supplied password is wrong.
          res.status(403).json({ error: 'Current password is incorrect' });
          return;
        }

        const passwordHash = await bcrypt.hash(newPassword, PASSWORD_BCRYPT_ROUNDS);
        db.prepare(
          `UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL,
             updated_at = datetime('now') WHERE id = ?`,
        ).run(passwordHash, check.user.id);

        // Kill every existing session for this database, then give this client a fresh one
        // (req.logIn regenerates).
        destroyAllSessions(db);
        await invalidateAllSessions();
        req.logIn(sessionUser, (loginErr) => {
          if (loginErr) return next(loginErr);
          res.json({ success: true, message: 'Password changed' });
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // --- API Key Management ---
  router.use('/api-keys', requireAuth(db));

  // Listing and creating keys need 'admin'; rotate/revoke are checked per key below.
  router.get('/api-keys', requireScope('admin'), (req: Request, res: Response): void => {
    const keys = db
      .prepare<
        [],
        ApiKey
      >('SELECT * FROM api_keys WHERE revoked_at IS NULL ORDER BY created_at DESC')
      .all();
    res.json(keys.map(toApiKeyResponse));
  });

  router.post(
    '/api-keys',
    requireScope('admin'),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const parsed = createApiKeySchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          res.status(400).json({
            error: `Invalid API key request: ${parsed.error.issues[0]?.message ?? 'invalid body'}. Scopes must be any of ${API_KEY_SCOPES.join(', ')}.`,
          });
          return;
        }
        const { name, scopes } = parsed.data;
        const key = generateApiKey();
        const keyHash = await hashApiKey(key, config.apiKeyBcryptRounds);
        const { prefix, last4 } = getKeyIdentifiers(key);

        const result = db
          .prepare(
            `INSERT INTO api_keys(name, key_hash, key_prefix, key_last4, user_id, scopes)
VALUES(?, ?, ?, ?, ?, ?)`,
          )
          .run(name, keyHash, prefix, last4, req.user?.id ?? null, JSON.stringify(scopes));

        // Return the key ONCE — it will never be shown again
        res.status(201).json({
          id: result.lastInsertRowid,
          name,
          scopes,
          key, // Only time the full key is returned
          maskedKey: `${'•'.repeat(8)}${last4} `,
          message: 'Save this API key — it will not be shown again.',
        });
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete('/api-keys/:id', (req: Request, res: Response): void => {
    const id = parseKeyId(req.params['id']);
    if (id === null) {
      res.status(400).json({ error: 'Invalid API key id' });
      return;
    }
    if (!checkKeyOwnership(req, res, id)) return;
    db.prepare(
      "UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL",
    ).run(id);
    res.json({ success: true });
  });

  // --- API Key Rotation ---
  // Revokes the current (or specified) key and generates a new one
  router.post(
    '/api-keys/rotate',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        // Use provided keyId, or fall back to the current API key being used for auth
        const { keyId: providedKeyId } = (req.body ?? {}) as { keyId?: unknown };
        const keyId =
          providedKeyId === undefined || providedKeyId === null
            ? (req.apiKey?.apiKeyId ?? null)
            : parseKeyId(providedKeyId);

        if (!keyId) {
          res
            .status(400)
            .json({ error: 'keyId is required (or authenticate with an API key to rotate it)' });
          return;
        }

        if (!checkKeyOwnership(req, res, keyId)) return;

        // Check the key exists and is not already revoked
        const existingKey = db
          .prepare<[number], ApiKey>('SELECT * FROM api_keys WHERE id = ? AND revoked_at IS NULL')
          .get(keyId);

        if (!existingKey) {
          res.status(404).json({ error: 'API key not found or already revoked' });
          return;
        }

        // Generate new key BEFORE revoking old one (atomic-ish operation)
        const newKey = generateApiKey();
        const keyHash = await hashApiKey(newKey, config.apiKeyBcryptRounds);
        const { prefix, last4 } = getKeyIdentifiers(newKey);

        // Use a transaction to ensure atomicity
        const rotateKey = db.transaction(() => {
          // Revoke the old key
          db.prepare("UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ?").run(keyId);

          // Insert new key
          const result = db
            .prepare(
              `INSERT INTO api_keys(name, key_hash, key_prefix, key_last4, user_id, scopes)
VALUES(?, ?, ?, ?, ?, ?)`,
            )
            .run(existingKey.name, keyHash, prefix, last4, existingKey.user_id, existingKey.scopes);

          return result;
        });

        const result = rotateKey();

        res.status(201).json({
          id: result.lastInsertRowid,
          name: existingKey.name,
          apiKey: newKey, // Only time the full key is returned
          maskedKey: `${'•'.repeat(8)}${last4} `,
          message: 'API key rotated. Save the new key — it will not be shown again.',
          revokedKeyId: keyId,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
