/**
 * Settings API routes for app configuration.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import bcrypt from 'bcrypt';
import type Database from 'better-sqlite3';
import {
  DEFAULT_OIDC_CALLBACK_URL,
  DEFAULT_OIDC_SCOPES,
  OidcAuthConfigSchema,
  type AuthMode,
  type OidcAuthConfig,
} from '../../config/auth.js';
import {
  NotificationService,
  type NotificationChannel,
} from '../services/NotificationService.js';
import {
  SettingsBackupService,
  type BackupSettingsState,
} from '../services/settingsBackup.js';

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
  webhookEnabled: boolean;
  defaultWebhookUrl: string;
  defaultSlackToken: string;
  defaultSlackChannel: string;
}

interface NotificationTestRequest extends Partial<NotificationSettings> {
  channel: NotificationChannel;
}

interface BackupSettingsUpdateRequest {
  enabled?: boolean;
  directory?: string;
  retentionCount?: number;
}

interface BackupImportRequest {
  sql?: string;
}

function getSettingValue(db: Database.Database, key: string): string | undefined {
  return db.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?').get(key)
    ?.value;
}

function getSettingString(db: Database.Database, key: string, defaultValue = ''): string {
  return getSettingValue(db, key) || defaultValue;
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

function normalizeScopes(value: string[] | string | undefined): string[] {
  const rawValues = Array.isArray(value) ? value : (value || '').split(',');
  const normalized = rawValues.map((scope) => scope.trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : [...DEFAULT_OIDC_SCOPES];
}

function getOidcSettings(db: Database.Database): OidcAuthConfig {
  return {
    issuerUrl: getSettingValue(db, 'oidc_issuer_url') ?? process.env['FILTARR_OIDC_ISSUER'] ?? '',
    clientId: getSettingValue(db, 'oidc_client_id') ?? process.env['FILTARR_OIDC_CLIENT_ID'] ?? '',
    clientSecret:
      getSettingValue(db, 'oidc_client_secret') ?? process.env['FILTARR_OIDC_CLIENT_SECRET'] ?? '',
    callbackUrl:
      getSettingValue(db, 'oidc_callback_url') ??
      process.env['FILTARR_OIDC_CALLBACK_URL'] ??
      DEFAULT_OIDC_CALLBACK_URL,
    scopes: normalizeScopes(
      getSettingValue(db, 'oidc_scopes') ?? process.env['FILTARR_OIDC_SCOPES'] ?? undefined,
    ),
  };
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
      const webhookEnabled = getSettingBoolean(db, 'webhook_enabled');
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

  // POST /api/v1/settings/notifications/test — send a channel-specific test notification
  router.post('/notifications/test', async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        channel,
        defaultWebhookUrl,
        defaultSlackToken,
        defaultSlackChannel,
      } = req.body as Partial<NotificationTestRequest>;

      if (channel !== 'slack' && channel !== 'webhook') {
        res.status(400).json({ error: 'Invalid notification channel' });
        return;
      }

      const notificationService = new NotificationService(db);
      await notificationService.sendTestNotification(channel, {
        defaultWebhookUrl,
        defaultSlackToken,
        defaultSlackChannel,
      });

      res.json({
        success: true,
        message:
          channel === 'slack'
            ? 'Slack test notification sent successfully'
            : 'Webhook test notification sent successfully',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send test notification';
      const statusCode =
        message.includes('required') || message === 'Invalid notification channel' ? 400 : 502;
      res.status(statusCode).json({ error: message });
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

  // GET /api/v1/settings/backup — get backup settings and recent backup files
  router.get('/backup', (_req: Request, res: Response): void => {
    try {
      const backupState = backupService.getState();
      res.json({
        ...backupState,
        redactionNotes: SettingsBackupService.getRedactionNotes(),
      } satisfies BackupSettingsState & { redactionNotes: readonly string[] });
    } catch {
      res.status(500).json({ error: 'Failed to fetch backup settings' });
    }
  });

  // PUT /api/v1/settings/backup — update backup settings
  router.put('/backup', (req: Request, res: Response): void => {
    try {
      const { enabled, directory, retentionCount } = req.body as BackupSettingsUpdateRequest;

      if (enabled !== undefined && typeof enabled !== 'boolean') {
        res.status(400).json({ error: 'Backup enabled flag must be a boolean' });
        return;
      }

      if (directory !== undefined && typeof directory !== 'string') {
        res.status(400).json({ error: 'Backup directory must be a string' });
        return;
      }

      if (
        retentionCount !== undefined &&
        (!Number.isInteger(retentionCount) || retentionCount < 1)
      ) {
        res.status(400).json({ error: 'Backup retention count must be a positive integer' });
        return;
      }

      const backupState = backupService.updateSettings({ enabled, directory, retentionCount });

      res.json({
        success: true,
        message: 'Backup settings saved successfully',
        ...backupState,
        redactionNotes: SettingsBackupService.getRedactionNotes(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update backup settings';
      const statusCode = message.includes('positive integer') ? 400 : 500;
      res.status(statusCode).json({ error: message });
    }
  });

  // POST /api/v1/settings/backup/create — create a manual backup immediately
  router.post('/backup/create', (_req: Request, res: Response): void => {
    try {
      const backup = backupService.createBackup('manual');
      res.status(201).json({
        success: true,
        message: 'Backup created successfully',
        backup,
      });
    } catch {
      res.status(500).json({ error: 'Failed to create backup' });
    }
  });

  // POST /api/v1/settings/backup/import — import a redacted SQL backup
  router.post('/backup/import', (req: Request, res: Response): void => {
    try {
      const body = req.body as BackupImportRequest;
      const sqlInput: unknown = body.sql;

      // Validate that the input is a non-empty string before proceeding.
      // This uses a type-narrowing guard so CodeQL sees the check as structural,
      // not as a user-controlled bypass of a security gate.
      if (typeof sqlInput !== 'string') {
        res.status(400).json({ error: 'Backup SQL is required' });
        return;
      }

      const trimmedSql = sqlInput.trim();
      if (trimmedSql.length === 0) {
        res.status(400).json({ error: 'Backup SQL is required' });
        return;
      }

      const result = backupService.importBackup(trimmedSql);
      onAuthModeChange?.(getCurrentAuthMode(db));

      res.json({
        success: true,
        message:
          'Backup imported successfully. Sensitive values were redacted and must be re-entered.',
        ...result,
        redactionNotes: SettingsBackupService.getRedactionNotes(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to import backup';
      const statusCode = message.includes('required') || message.includes('could not be imported') ? 400 : 500;
      res.status(statusCode).json({ error: message });
    }
  });

  return router;
}
