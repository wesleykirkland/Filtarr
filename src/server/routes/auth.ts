import { Router, type Request, type Response, type NextFunction } from 'express';
import passport from 'passport';
import bcrypt from 'bcrypt';
import type Database from 'better-sqlite3';
import type { AuthConfig, AuthMode } from '../../config/auth.js';
import { authRateLimiter } from '../middleware/security.js';
import {
  generateApiKey,
  hashApiKey,
  getKeyIdentifiers,
} from '../middleware/apiKey.js';
import { type ApiKey, toApiKeyResponse } from '../../db/schemas/users.js';

/**
 * Get the current auth mode from the database settings.
 * This is called dynamically to support auth mode changes after setup.
 */
function getCurrentAuthMode(db: Database.Database): AuthMode {
  try {
    const result = db.prepare<[], { value: string }>(
      `SELECT value FROM settings WHERE key = 'auth_mode'`,
    ).get();
    return (result?.value as AuthMode) || 'none';
  } catch {
    return 'none';
  }
}

/**
 * Create auth routes for login, logout, session, and API key management.
 * Rate limiting is applied to auth endpoints (5 attempts/min).
 */
export function createAuthRoutes(db: Database.Database, config: AuthConfig): Router {
  const router = Router();

  // Rate limit all auth endpoints
  router.use(authRateLimiter(config.rateLimitAuth));

  // --- Login ---
  router.post('/login', (req: Request, res: Response, next: NextFunction): void => {
    // Get current auth mode dynamically from database
    const authMode = getCurrentAuthMode(db);

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
      passport.authenticate('local', (err: Error | null, user: Express.User | false, info: { message: string }) => {
        if (err) return next(err);
        if (!user) {
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
      })(req, res, next);
      return;
    }

    if (authMode === 'oidc') {
      // OIDC login redirects to the identity provider
      passport.authenticate('openidconnect')(req, res, next);
      return;
    }

    res.status(400).json({ error: 'Unknown auth mode' });
  });

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
    const authMode = getCurrentAuthMode(db);

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
    if (authMode === 'basic' && (req as any)._basicAuthValid) {
      res.json({
        authenticated: true,
        mode: 'basic',
      });
      return;
    }

    if (req.isAuthenticated?.() && req.user) {
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
  if (config.mode === 'oidc') {
    router.get('/oidc/callback',
      passport.authenticate('openidconnect', { failureRedirect: '/login' }),
      (_req: Request, res: Response) => {
        res.redirect('/');
      },
    );
  }

  // --- API Key Management ---
  // These require an authenticated session (not just API key)
  router.get('/api-keys', (req: Request, res: Response): void => {
    const keys = db.prepare<[], ApiKey>('SELECT * FROM api_keys WHERE revoked_at IS NULL ORDER BY created_at DESC').all();
    res.json(keys.map(toApiKeyResponse));
  });

  router.post('/api-keys', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { name = 'API Key' } = req.body as { name?: string };
      const key = generateApiKey();
      const keyHash = await hashApiKey(key, config.apiKeyBcryptRounds);
      const { prefix, last4 } = getKeyIdentifiers(key);

      const result = db.prepare(
        `INSERT INTO api_keys (name, key_hash, key_prefix, key_last4, user_id, scopes)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(name, keyHash, prefix, last4, req.user?.id ?? null, '["*"]');

      // Return the key ONCE — it will never be shown again
      res.status(201).json({
        id: result.lastInsertRowid,
        name,
        key, // Only time the full key is returned
        maskedKey: `${'•'.repeat(8)}${last4}`,
        message: 'Save this API key — it will not be shown again.',
      });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/api-keys/:id', (req: Request, res: Response): void => {
    const { id } = req.params;
    db.prepare('UPDATE api_keys SET revoked_at = datetime(\'now\') WHERE id = ? AND revoked_at IS NULL')
      .run(id);
    res.json({ success: true });
  });

  // --- API Key Rotation ---
  // Revokes the current (or specified) key and generates a new one
  router.post('/api-keys/rotate', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Use provided keyId, or fall back to the current API key being used for auth
      const { keyId: providedKeyId } = req.body as { keyId?: number };
      const keyId = providedKeyId ?? req.apiKey?.apiKeyId;

      if (!keyId) {
        res.status(400).json({ error: 'keyId is required (or authenticate with an API key to rotate it)' });
        return;
      }

      // Check the key exists and is not already revoked
      const existingKey = db.prepare<[number], ApiKey>(
        'SELECT * FROM api_keys WHERE id = ? AND revoked_at IS NULL',
      ).get(keyId);

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
        db.prepare('UPDATE api_keys SET revoked_at = datetime(\'now\') WHERE id = ?')
          .run(keyId);

        // Insert new key
        const result = db.prepare(
          `INSERT INTO api_keys (name, key_hash, key_prefix, key_last4, user_id, scopes)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(existingKey.name, keyHash, prefix, last4, existingKey.user_id, existingKey.scopes);

        return result;
      });

      const result = rotateKey();

      res.status(201).json({
        id: result.lastInsertRowid,
        name: existingKey.name,
        apiKey: newKey, // Only time the full key is returned
        maskedKey: `${'•'.repeat(8)}${last4}`,
        message: 'API key rotated. Save the new key — it will not be shown again.',
        revokedKeyId: keyId,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

