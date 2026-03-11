import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { decryptStoredSecret, encryptStoredSecret } from '../../src/services/encryption.js';
import { migrateEncryptedSecrets } from '../../src/db/secretMigration.js';

describe('migrateEncryptedSecrets', () => {
  it('encrypts legacy filter and settings secrets while leaving encrypted rows intact', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE filters (
        id INTEGER PRIMARY KEY,
        notify_webhook_url TEXT,
        notify_slack_token TEXT,
        updated_at TEXT
      );
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT
      );
    `);

    const existingEncrypted = encryptStoredSecret('already-encrypted', '.');
    db.prepare('INSERT INTO filters (id, notify_webhook_url, notify_slack_token) VALUES (?, ?, ?)').run(
      1,
      'https://hooks.example.com/plain',
      existingEncrypted,
    );
    db.prepare(`INSERT INTO settings (key, value) VALUES ('slack_webhook_url', ?)`).run(
      'https://hooks.slack.com/services/plain',
    );

    migrateEncryptedSecrets(db);

    const filterRow = db
      .prepare<[], { notify_webhook_url: string; notify_slack_token: string }>(
        'SELECT notify_webhook_url, notify_slack_token FROM filters WHERE id = 1',
      )
      .get();
    const settingsRow = db
      .prepare<[], { value: string }>(`SELECT value FROM settings WHERE key = 'slack_webhook_url'`)
      .get();

    expect(filterRow?.notify_webhook_url).toMatch(/^enc:/);
    expect(decryptStoredSecret(filterRow?.notify_webhook_url, '.')).toBe('https://hooks.example.com/plain');
    expect(filterRow?.notify_slack_token).toBe(existingEncrypted);
    expect(settingsRow?.value).toMatch(/^enc:/);
    expect(decryptStoredSecret(settingsRow?.value, '.')).toBe('https://hooks.slack.com/services/plain');

    db.close();
  });
});