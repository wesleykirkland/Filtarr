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

interface AppSettings {
  validationIntervalMinutes: number;
}

interface NotificationSettings {
  slackEnabled: boolean;
  webhookEnabled: boolean;
  defaultWebhookUrl: string;
  defaultSlackToken: string;
  defaultSlackChannel: string;
}

function getSettingString(db: Database.Database, key: string, defaultValue = ''): string {
  return (
    db.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?').get(key)
      ?.value || defaultValue
  );
}

function getSettingBoolean(db: Database.Database, key: string, defaultValue = false): boolean {
  const value = db
    .prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?')
    .get(key)?.value;

  if (value === undefined) return defaultValue;
  return value === '1';
}

function upsertSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(
    `INSERT OR REPLACE INTO settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))`,
  ).run(key, value);
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

  // GET /api/v1/settings/notifications — get global notification settings
  router.get('/notifications', (_req: Request, res: Response): void => {
    try {
      const slackEnabled = getSettingBoolean(db, 'slack_enabled');
      const webhookEnabled = getSettingBoolean(db, 'webhook_enabled', true);
      const defaultWebhookUrl = getSettingString(db, 'default_webhook_url');
      const defaultSlackToken = getSettingString(db, 'default_slack_token');
      const defaultSlackChannel = getSettingString(db, 'default_slack_channel');

      res.json({
        slackEnabled,
        webhookEnabled,
        defaultWebhookUrl,
        defaultSlackToken,
        defaultSlackChannel,
      });
    } catch {
      res.status(500).json({ error: 'Failed to fetch notification settings' });
    }
  });

  // PUT /api/v1/settings/notifications — update global notification settings
  router.put('/notifications', (req: Request, res: Response): void => {
    try {
      const {
        slackEnabled,
        webhookEnabled,
        defaultWebhookUrl,
        defaultSlackToken,
        defaultSlackChannel,
      } = req.body as Partial<NotificationSettings>;

      if (typeof slackEnabled === 'boolean') {
        upsertSetting(db, 'slack_enabled', slackEnabled ? '1' : '0');
      }

      if (typeof webhookEnabled === 'boolean') {
        upsertSetting(db, 'webhook_enabled', webhookEnabled ? '1' : '0');
      }

      if (defaultWebhookUrl !== undefined) {
        upsertSetting(db, 'default_webhook_url', defaultWebhookUrl || '');
      }

      if (defaultSlackToken !== undefined) {
        upsertSetting(db, 'default_slack_token', defaultSlackToken || '');
      }

      if (defaultSlackChannel !== undefined) {
        upsertSetting(db, 'default_slack_channel', defaultSlackChannel || '');
      }

      res.json({
        success: true,
        message: 'Notification settings saved successfully',
      });
    } catch {
      res.status(500).json({ error: 'Failed to update notification settings' });
    }
  });

  return router;
}
