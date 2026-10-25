import type { Database } from 'better-sqlite3';
import { encryptStoredSecret, isEncryptedStoredSecret } from '../services/encryption.js';
import { FILTER_SECRET_CONTEXTS } from './schemas/filters.js';

interface FilterSecretRow {
  id: number;
  notify_webhook_url: string | null;
  notify_slack_token: string | null;
}

/** Settings rows whose values are secrets and must be encrypted at rest. */
export const ENCRYPTED_SETTING_KEYS = [
  'slack_webhook_url',
  'default_webhook_url',
  'default_slack_token',
  'oidc_client_secret',
] as const;

function normalizeSecret(value: string | null, context?: string): string | null {
  if (!value || isEncryptedStoredSecret(value)) return value;
  return encryptStoredSecret(value, undefined, context);
}

export function migrateEncryptedSecrets(db: Database): void {
  const migrateFilters = db.transaction(() => {
    const rows = db
      .prepare<[], FilterSecretRow>(
        `SELECT id, notify_webhook_url, notify_slack_token
         FROM filters
         WHERE notify_webhook_url IS NOT NULL OR notify_slack_token IS NOT NULL`,
      )
      .all();

    const update = db.prepare(
      `UPDATE filters
       SET notify_webhook_url = ?, notify_slack_token = ?, updated_at = datetime('now')
       WHERE id = ?`,
    );

    for (const row of rows) {
      const nextWebhook = normalizeSecret(row.notify_webhook_url, FILTER_SECRET_CONTEXTS.webhookUrl);
      const nextSlackToken = normalizeSecret(row.notify_slack_token, FILTER_SECRET_CONTEXTS.slackToken);

      if (
        nextWebhook !== row.notify_webhook_url ||
        nextSlackToken !== row.notify_slack_token
      ) {
        update.run(nextWebhook, nextSlackToken, row.id);
      }
    }
  });

  migrateFilters();

  const updateSetting = db.prepare(
    `INSERT OR REPLACE INTO settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))`,
  );

  for (const key of ENCRYPTED_SETTING_KEYS) {
    const row = db
      .prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?')
      .get(key);

    if (row?.value && !isEncryptedStoredSecret(row.value)) {
      updateSetting.run(key, encryptStoredSecret(row.value));
    }
  }
}
