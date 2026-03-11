import type { Database } from 'better-sqlite3';
import { encryptStoredSecret, isEncryptedStoredSecret } from '../services/encryption.js';

interface FilterSecretRow {
  id: number;
  notify_webhook_url: string | null;
  notify_slack_token: string | null;
}

function normalizeSecret(value: string | null): string | null {
  if (!value || isEncryptedStoredSecret(value)) return value;
  return encryptStoredSecret(value);
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
      const nextWebhook = normalizeSecret(row.notify_webhook_url);
      const nextSlackToken = normalizeSecret(row.notify_slack_token);

      if (
        nextWebhook !== row.notify_webhook_url ||
        nextSlackToken !== row.notify_slack_token
      ) {
        update.run(nextWebhook, nextSlackToken, row.id);
      }
    }
  });

  migrateFilters();

  const slackWebhook = db
    .prepare<[], { value: string }>(`SELECT value FROM settings WHERE key = 'slack_webhook_url'`)
    .get();

  if (slackWebhook?.value && !isEncryptedStoredSecret(slackWebhook.value)) {
    db.prepare(
      `INSERT OR REPLACE INTO settings (key, value, updated_at)
       VALUES ('slack_webhook_url', ?, datetime('now'))`,
    ).run(encryptStoredSecret(slackWebhook.value));
  }
}