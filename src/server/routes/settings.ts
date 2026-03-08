/**
 * Settings API routes for app configuration.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import bcrypt from 'bcrypt';
import type Database from 'better-sqlite3';
import type { AuthMode } from '../../config/auth.js';
import { NotificationService } from '../services/NotificationService.js';

interface ChangeAuthModeRequest {
  authMode: AuthMode;
  username?: string;
  password?: string;
}

interface AppSettings {
  validationIntervalMinutes: number;
}

/**
 * Get the current auth mode from the database settings.
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

/**
 * Check if any admin users exist in the database.
 */
function hasAdminUser(db: Database.Database): boolean {
  try {
    const result = db.prepare<[], { count: number }>('SELECT COUNT(*) as count FROM users').get();
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
  router.put(
    '/auth-mode',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { authMode, username, password } = req.body as ChangeAuthModeRequest;

        // Validate authMode
        if (!['none', 'basic', 'forms'].includes(authMode)) {
          res.status(400).json({ error: 'Invalid auth mode. Must be none, basic, or forms' });
          return;
        }

        const hasAdmin = hasAdminUser(db);

        // If switching TO basic/forms and no admin exists, require username/password
        if (authMode !== 'none' && !hasAdmin) {
          if (!username || username.length < 1) {
            res.status(400).json({
              error: 'Username is required when enabling authentication without existing users',
            });
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
    },
  );

  // GET /api/v1/settings/app — get general app settings
  router.get('/app', (_req: Request, res: Response): void => {
    try {
      const result = db
        .prepare<
          [],
          { value: string }
        >(`SELECT value FROM settings WHERE key = 'validation_interval_minutes'`)
        .get();
      const interval = parseInt(result?.value || '60', 10);
      res.json({
        validationIntervalMinutes: isNaN(interval) ? 60 : interval,
      });
    } catch {
      res.status(500).json({ error: 'Failed to fetch app settings' });
    }
  });

  // PUT /api/v1/settings/app — update general app settings
  router.put('/app', (req: Request, res: Response): void => {
    try {
      const { validationIntervalMinutes } = req.body as AppSettings;

      if (typeof validationIntervalMinutes !== 'number' || validationIntervalMinutes < 1) {
        res.status(400).json({ error: 'Validation interval must be a positive number' });
        return;
      }

      db.prepare(
        `INSERT OR REPLACE INTO settings (key, value, updated_at)
         VALUES ('validation_interval_minutes', ?, datetime('now'))`,
      ).run(validationIntervalMinutes.toString());

      res.json({
        success: true,
        validationIntervalMinutes,
        message: 'Settings saved successfully',
      });
    } catch {
      res.status(500).json({ error: 'Failed to update app settings' });
    }
  });

  // GET /api/v1/settings/notifications
  router.get('/notifications', (_req: Request, res: Response): void => {
    try {
      const rows = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'notify_global_%'").all() as { key: string; value: string }[];
      const settings: Record<string, string> = {};
      for (const row of rows) {
        settings[row.key] = row.value;
      }
      res.json(settings);
    } catch {
      res.status(500).json({ error: 'Failed to fetch notification settings' });
    }
  });

  // PUT /api/v1/settings/notifications
  router.put('/notifications', (req: Request, res: Response): void => {
    try {
      const { enabled, type, url, slackToken, slackChannel } = req.body;

      const updates = [
        { key: 'notify_global_enabled', value: enabled ? '1' : '0' },
        { key: 'notify_global_type', value: type },
        { key: 'notify_global_url', value: url || '' },
        { key: 'notify_global_slack_token', value: slackToken || '' },
        { key: 'notify_global_slack_channel', value: slackChannel || '' },
      ];

      const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))");
      const transaction = db.transaction((items) => {
        for (const item of items) stmt.run(item.key, item.value);
      });
      transaction(updates);

      res.json({ success: true, message: 'Notification settings saved' });
    } catch {
      res.status(500).json({ error: 'Failed to update notification settings' });
    }
  });

  // POST /api/v1/settings/notifications/test
  router.post('/notifications/test', async (_req: Request, res: Response): Promise<void> => {
    try {
      const notifier = new NotificationService(db);
      await notifier.sendNotification({
        event: 'test',
        message: 'This is a test notification from Filtarr. Your settings are correctly configured!',
        timestamp: new Date().toISOString(),
      });
      res.json({ success: true, message: 'Test notification sent' });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to send test notification: ' + err.message });
    }
  });

  return router;
}
