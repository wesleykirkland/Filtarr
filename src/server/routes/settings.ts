/**
 * Settings API routes for app configuration.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import bcrypt from 'bcrypt';
import type Database from 'better-sqlite3';
import type { AuthMode } from '../../config/auth.js';
import { decryptStoredSecret, encryptStoredSecret } from '../../services/encryption.js';
import { SecurityPolicyError, validateWebhookUrl } from '../../services/security.js';
import { recordActivityEvent } from '../lib/activity.js';

interface ChangeAuthModeRequest {
  authMode: AuthMode;
  username?: string;
  password?: string;
  oidc?: Partial<OidcAuthConfig>;
}

interface AppSettings {
  validationIntervalMinutes: number;
}

interface NotificationSettings {
  slackEnabled: boolean;
  slackWebhookUrl: string;
  webhookEnabled: boolean;
}

function getSettingValue(db: Database.Database, key: string): string | null {
  return db.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?').get(key)?.value || null;
}

function getNotificationSecret(db: Database.Database, key: string): string | null {
  return decryptStoredSecret(getSettingValue(db, key));
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
  backupService: SettingsBackupService = new SettingsBackupService(db),
): Router {
  const router = Router();

  // GET /api/v1/settings/auth-mode — get current auth mode
  router.get('/auth-mode', (_req: Request, res: Response): void => {
    const authMode = getCurrentAuthMode(db);
    const hasAdmin = hasAdminUser(db);
    res.json({ authMode, hasAdminUser: hasAdmin, oidc: getOidcSettings(db) });
  });

  // PUT /api/v1/settings/auth-mode — change authentication mode
  router.put(
    '/auth-mode',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { authMode, username, password, oidc } = req.body as ChangeAuthModeRequest;

        // Validate authMode
        if (!['none', 'basic', 'forms', 'oidc'].includes(authMode)) {
          res.status(400).json({ error: 'Invalid auth mode. Must be none, basic, forms, or oidc' });
          return;
        }

        const hasAdmin = hasAdminUser(db);

        if (oidc || authMode === 'oidc') {
          const existingOidc = getOidcSettings(db);
          const oidcCandidate = {
            issuerUrl: oidc?.issuerUrl?.trim() ?? existingOidc.issuerUrl,
            clientId: oidc?.clientId?.trim() ?? existingOidc.clientId,
            clientSecret: oidc?.clientSecret?.trim() ?? existingOidc.clientSecret,
            callbackUrl: oidc?.callbackUrl?.trim() ?? existingOidc.callbackUrl,
            scopes: normalizeScopes(oidc?.scopes ?? existingOidc.scopes),
          };

          const parsedOidc = OidcAuthConfigSchema.safeParse(oidcCandidate);
          if (!parsedOidc.success) {
            res.status(400).json({ error: parsedOidc.error.issues[0]?.message || 'Invalid OIDC configuration' });
            return;
          }

          upsertSetting(db, 'oidc_issuer_url', parsedOidc.data.issuerUrl);
          upsertSetting(db, 'oidc_client_id', parsedOidc.data.clientId);
          upsertSetting(db, 'oidc_client_secret', parsedOidc.data.clientSecret);
          upsertSetting(db, 'oidc_callback_url', parsedOidc.data.callbackUrl);
          upsertSetting(db, 'oidc_scopes', parsedOidc.data.scopes.join(','));
        }

        // If switching TO basic/forms and no admin exists, require username/password
        if ((authMode === 'basic' || authMode === 'forms') && !hasAdmin) {
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

        recordActivityEvent(db, {
          type: 'updated',
          source: 'settings',
          message: `Authentication mode changed to ${authMode}`,
          details: { authMode, createdAdminUser: authMode !== 'none' && !hasAdmin },
        });

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
      const interval = parseInt(result?.value || '15', 10);
      res.json({
        validationIntervalMinutes: isNaN(interval) ? 15 : interval,
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

      recordActivityEvent(db, {
        type: 'updated',
        source: 'settings',
        message: 'General settings updated',
        details: { validationIntervalMinutes },
      });

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
      const slackEnabled =
        db
          .prepare<[], { value: string }>(`SELECT value FROM settings WHERE key = 'slack_enabled'`)
          .get()?.value === '1';
      const slackWebhookUrl = getNotificationSecret(db, 'slack_webhook_url');
      const webhookEnabled =
        db
          .prepare<[], { value: string }>(
            `SELECT value FROM settings WHERE key = 'webhook_enabled'`,
          )
          .get()?.value !== '0'; // defaults to enabled for backward compat

      res.json({
        slackEnabled,
        slackWebhookUrl: '',
        slackWebhookUrlConfigured: Boolean(slackWebhookUrl),
        webhookEnabled,
      });
    } catch {
      res.status(500).json({ error: 'Failed to fetch notification settings' });
    }
  });

  // PUT /api/v1/settings/notifications — update global notification settings
  router.put('/notifications', (req: Request, res: Response): void => {
    try {
      const { slackEnabled, slackWebhookUrl, webhookEnabled } = req.body as NotificationSettings;

      if (typeof slackEnabled === 'boolean') {
        db.prepare(
          `INSERT OR REPLACE INTO settings (key, value, updated_at)
           VALUES ('slack_enabled', ?, datetime('now'))`,
        ).run(slackEnabled ? '1' : '0');
      }

      if (slackWebhookUrl !== undefined) {
        if (typeof slackWebhookUrl !== 'string') {
          res.status(400).json({ error: 'slackWebhookUrl must be a string' });
          return;
        }

        db.prepare(
          `INSERT OR REPLACE INTO settings (key, value, updated_at)
           VALUES ('slack_webhook_url', ?, datetime('now'))`,
        ).run(
          encryptStoredSecret(
            slackWebhookUrl ? validateWebhookUrl(slackWebhookUrl, { fieldName: 'slackWebhookUrl' }) : '',
          ) || '',
        );
      }

      if (typeof webhookEnabled === 'boolean') {
        db.prepare(
          `INSERT OR REPLACE INTO settings (key, value, updated_at)
           VALUES ('webhook_enabled', ?, datetime('now'))`,
        ).run(webhookEnabled ? '1' : '0');
      }

      recordActivityEvent(db, {
        type: 'updated',
        source: 'settings',
        message: 'Notification settings updated',
        details: {
          slackEnabled,
          webhookEnabled,
          slackWebhookConfigured: Boolean(slackWebhookUrl),
        },
      });

      res.json({
        success: true,
        message: 'Notification settings saved successfully',
      });
    } catch (err) {
      if (err instanceof SecurityPolicyError) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'Failed to update notification settings' });
    }
  });

  return router;
}
