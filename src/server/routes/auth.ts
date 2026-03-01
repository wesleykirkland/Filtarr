import { Router, type Request, type Response, type NextFunction } from 'express';
import passport from 'passport';
import bcrypt from 'bcrypt';
import type Database from 'better-sqlite3';
import type { AuthConfig } from '../../config/auth.js';
import { authRateLimiter } from '../middleware/security.js';
import {
  generateApiKey,
  hashApiKey,
  getKeyIdentifiers,
} from '../middleware/apiKey.js';
import { type ApiKey, toApiKeyResponse } from '../../db/schemas/users.js';

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
    if (config.mode === 'none') {
      res.json({ success: true, message: 'Auth disabled' });
      return;
    }

    if (config.mode === 'basic') {
      // Basic auth doesn't use login endpoint — it's header-based
      res.status(400).json({ error: 'Basic auth uses Authorization header, not login endpoint' });
      return;
    }

    if (config.mode === 'forms') {
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

    if (config.mode === 'oidc') {
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
    if (config.mode === 'none') {
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

    if (req.isAuthenticated?.() && req.user) {
      res.json({
        authenticated: true,
        mode: config.mode,
        user: { id: req.user.id, username: req.user.username, displayName: req.user.displayName },
      });
      return;
    }

    res.json({ authenticated: false, mode: config.mode });
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

  return router;
}

