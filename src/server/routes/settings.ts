/**
 * Settings API routes for app configuration.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import bcrypt from 'bcrypt';
import type Database from 'better-sqlite3';
import type { AuthMode } from '../../config/auth.js';

interface ChangeAuthModeRequest {
  authMode: AuthMode;
  username?: string;
  password?: string;
}

/**
 * Get the current auth mode from the database settings.
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
 * Check if any admin users exist in the database.
 */
function hasAdminUser(db: Database.Database): boolean {
  try {
    const result = db.prepare<[], { count: number }>(
      'SELECT COUNT(*) as count FROM users',
    ).get();
    return (result?.count ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Create settings routes for application configuration.
 * These endpoints require authentication.
 */
export function createSettingsRoutes(
  db: Database.Database,
  onAuthModeChange?: (authMode: AuthMode) => void,
): Router {
  const router = Router();

  // GET /api/v1/settings/auth-mode — get current auth mode
  router.get('/auth-mode', (_req: Request, res: Response): void => {
    const authMode = getCurrentAuthMode(db);
    const hasAdmin = hasAdminUser(db);
    res.json({ authMode, hasAdminUser: hasAdmin });
  });

  // PUT /api/v1/settings/auth-mode — change authentication mode
  router.put('/auth-mode', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { authMode, username, password } = req.body as ChangeAuthModeRequest;

      // Validate authMode
      if (!['none', 'basic', 'forms'].includes(authMode)) {
        res.status(400).json({ error: 'Invalid auth mode. Must be none, basic, or forms' });
        return;
      }

      const currentMode = getCurrentAuthMode(db);
      const hasAdmin = hasAdminUser(db);

      // If switching TO basic/forms and no admin exists, require username/password
      if (authMode !== 'none' && !hasAdmin) {
        if (!username || username.length < 1) {
          res.status(400).json({ error: 'Username is required when enabling authentication without existing users' });
          return;
        }
        if (!password || password.length < 8) {
          res.status(400).json({ error: 'Password must be at least 8 characters' });
          return;
        }

        // Create admin user
        const passwordHash = await bcrypt.hash(password, 12);
        db.prepare(
          `INSERT INTO users (username, password_hash, display_name)
           VALUES (?, ?, ?)`,
        ).run(username, passwordHash, 'Administrator');
      }

      // Update auth mode in settings
      db.prepare(
        `INSERT OR REPLACE INTO settings (key, value, updated_at)
         VALUES ('auth_mode', ?, datetime('now'))`,
      ).run(authMode);

      // Notify app of auth mode change (for runtime config update)
      if (onAuthModeChange) {
        onAuthModeChange(authMode);
      }

      res.json({
        success: true,
        authMode,
        message: `Authentication mode changed to "${authMode}"`,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

