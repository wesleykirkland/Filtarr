import { Router, type Request, type Response, type NextFunction } from 'express';
import bcrypt from 'bcrypt';
import type Database from 'better-sqlite3';
import { generateApiKey, hashApiKey, getKeyIdentifiers } from '../middleware/apiKey.js';
import { authRateLimiter } from '../middleware/security.js';
import type { AuthMode } from '../../config/auth.js';

interface SetupRequest {
  authMode: AuthMode;
  username: string;
  password: string;
}

/**
 * Check if setup is needed.
 * Setup is complete when 'setup_complete' flag exists in settings table.
 * This is separate from user existence to support "none" auth mode.
 */
function needsSetup(db: Database.Database): boolean {
  try {
    const result = db
      .prepare<[], { value: string }>(`SELECT value FROM settings WHERE key = 'setup_complete'`)
      .get();
    return result?.value !== 'true';
  } catch {
    // Table might not exist yet
    return true;
  }
}

/**
 * Create setup routes for initial configuration.
 * These endpoints are UNAUTHENTICATED — they only work when no admin exists.
 */
export function createSetupRoutes(
  db: Database.Database,
  onSetupComplete?: (authMode: AuthMode) => void,
): Router {
  const router = Router();

  // GET /api/v1/setup/status — check if setup is needed
  router.get('/status', (_req: Request, res: Response): void => {
    res.json({ needsSetup: needsSetup(db) });
  });

  // POST /api/v1/setup/complete — finish initial setup
  // Rate limited to prevent brute-force attacks
  router.post(
    '/complete',
    authRateLimiter(5),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        // SECURITY: Only allow setup when no users exist
        if (!needsSetup(db)) {
          res.status(403).json({ error: 'Setup already completed' });
          return;
        }

        const { authMode, username, password } = req.body as SetupRequest;

        // Validate authMode
        if (!['none', 'basic', 'forms'].includes(authMode)) {
          res.status(400).json({ error: 'Invalid auth mode. Must be none, basic, or forms' });
          return;
        }

        // Validate username and password for non-"none" modes
        if (authMode !== 'none') {
          if (!username || username.length < 1) {
            res.status(400).json({ error: 'Username is required' });
            return;
          }
          if (!password || password.length < 8) {
            res.status(400).json({ error: 'Password must be at least 8 characters' });
            return;
          }
        }

        // Ensure settings table exists
        db.exec(`
          CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          )
        `);

        // Create admin user only for non-"none" modes
        let userId: number | null = null;
        if (authMode !== 'none') {
          const passwordHash = await bcrypt.hash(password, 12);
          const result = db
            .prepare(
              `INSERT INTO users (username, password_hash, display_name)
             VALUES (?, ?, ?)`,
            )
            .run(username, passwordHash, 'Administrator');
          userId = Number(result.lastInsertRowid);
        }

        // Store auth mode in settings table
        db.prepare(
          `INSERT OR REPLACE INTO settings (key, value, updated_at)
           VALUES ('auth_mode', ?, datetime('now'))`,
        ).run(authMode);

        // Mark setup as complete (this is what needsSetup checks)
        db.prepare(
          `INSERT OR REPLACE INTO settings (key, value, updated_at)
           VALUES ('setup_complete', 'true', datetime('now'))`,
        ).run();

        // Generate initial API key
        const apiKey = generateApiKey();
        const keyHash = await hashApiKey(apiKey, 12);
        const { prefix, last4 } = getKeyIdentifiers(apiKey);

        db.prepare(
          `INSERT INTO api_keys (name, key_hash, key_prefix, key_last4, user_id, scopes)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run('Initial API Key', keyHash, prefix, last4, userId, '["*"]');

        // Notify app of setup completion (for runtime config update)
        if (onSetupComplete) {
          onSetupComplete(authMode);
        }

        res.status(201).json({
          apiKey,
          message: 'Setup complete. Save this API key — it will not be shown again.',
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}

/**
 * Get stored auth mode from database, or 'none' if not set.
 */
export function getStoredAuthMode(db: Database.Database): AuthMode {
  try {
    const result = db
      .prepare<[], { value: string }>(`SELECT value FROM settings WHERE key = 'auth_mode'`)
      .get();
    return (result?.value as AuthMode) || 'none';
  } catch {
    return 'none';
  }
}
