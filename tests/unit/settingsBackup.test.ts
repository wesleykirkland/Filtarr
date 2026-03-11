import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { decrypt, encrypt, resetEncryptionKey } from '../../src/services/encryption.js';
import { SettingsBackupService } from '../../src/server/services/settingsBackup.js';

interface SeedResult {
  userId: number;
  instanceId: number;
  filterId: number;
  directoryId: number;
}

function createDatabase(): Database.Database {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

function insertSetting(db: Database.Database, key: string, value: string) {
  db.prepare(
    `INSERT OR REPLACE INTO settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))`,
  ).run(key, value);
}

function seedDatabase(db: Database.Database, dataDir: string): SeedResult {
  insertSetting(db, 'auth_mode', 'forms');
  insertSetting(db, 'validation_interval_minutes', '45');
  insertSetting(db, 'default_webhook_url', 'https://secret-webhook.example.test/token');
  insertSetting(db, 'default_slack_token', 'xoxb-default-secret');
  insertSetting(db, 'default_slack_channel', '#alerts');
  insertSetting(db, 'oidc_issuer_url', 'https://issuer.example.test/realms/filtarr');
  insertSetting(db, 'oidc_client_id', 'filtarr-web');
  insertSetting(db, 'oidc_client_secret', 'oidc-client-secret');

  const userResult = db
    .prepare(
      `INSERT INTO users (username, password_hash, display_name)
       VALUES (?, ?, ?)`,
    )
    .run('admin', 'stored-password-hash', 'Administrator');
  const userId = Number(userResult.lastInsertRowid);

  db.prepare(
    `INSERT INTO sessions (id, user_id, data, expires_at)
     VALUES (?, ?, ?, datetime('now', '+1 day'))`,
  ).run('session-1', userId, '{"remember":true}');

  db.prepare(
    `INSERT INTO api_keys (name, key_hash, key_prefix, key_last4, user_id, scopes)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('Primary Key', 'hashed-api-key', 'filt', '1234', userId, '["*"]');

  db.prepare(
    `INSERT INTO events (type, source, message, details)
     VALUES (?, ?, ?, ?)`,
  ).run('info', 'test', 'sensitive event', '{"apiKey":"value"}');

  const instanceResult = db
    .prepare(
      `INSERT INTO arr_instances (name, type, url, api_key_encrypted, timeout, enabled, skip_ssl_verify)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run('Primary Sonarr', 'sonarr', 'http://sonarr.local', encrypt('arr-live-key', dataDir), 30000, 1, 0);
  const instanceId = Number(instanceResult.lastInsertRowid);

  const directoryResult = db
    .prepare(
      `INSERT INTO directories (path, recursive, enabled)
       VALUES (?, ?, ?)`,
    )
    .run('/downloads/series', 1, 1);
  const directoryId = Number(directoryResult.lastInsertRowid);

  const filterResult = db
    .prepare(
      `INSERT INTO filters (
        name, description, trigger_source, rule_type, rule_payload,
        action_type, action_payload, script_runtime, target_path,
        notify_on_match, notify_webhook_url, notify_slack,
        notify_slack_token, notify_slack_channel, override_notifications,
        instance_id, enabled, sort_order
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'Episode Filter',
      'Moves matching releases',
      'watcher',
      'contains',
      '{"value":"1080p"}',
      'move',
      '{"destination":"/library/series"}',
      'javascript',
      '/downloads/series',
      1,
      'https://filter-webhook.example.test/token',
      1,
      'xoxb-filter-secret',
      '#filter-alerts',
      1,
      instanceId,
      1,
      0,
    );
  const filterId = Number(filterResult.lastInsertRowid);

  db.prepare(
    `INSERT INTO jobs (name, description, schedule, type, payload, enabled)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('Nightly Scan', 'Process recent media', '0 0 * * *', 'filter_run', '{"filterId":1}', 1);

  db.prepare(
    `INSERT INTO filter_instances (filter_id, instance_id)
     VALUES (?, ?)`,
  ).run(filterId, instanceId);

  db.prepare(
    `INSERT INTO directory_filters (directory_id, filter_id)
     VALUES (?, ?)`,
  ).run(directoryId, filterId);

  return { userId, instanceId, filterId, directoryId };
}

describe('SettingsBackupService', () => {
  const cleanupPaths: string[] = [];
  const cleanupDbs: Database.Database[] = [];

  afterEach(() => {
    while (cleanupDbs.length > 0) {
      cleanupDbs.pop()?.close();
    }

    while (cleanupPaths.length > 0) {
      const target = cleanupPaths.pop();
      if (target && fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true });
      }
    }

    resetEncryptionKey();
  });

  it('creates a redacted SQL backup that omits live secrets and auth data', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filtarr-backup-export-'));
    const backupDir = path.join(rootDir, 'backups');
    const dataDir = path.join(rootDir, 'data');
    cleanupPaths.push(rootDir);

    const db = createDatabase();
    cleanupDbs.push(db);
    seedDatabase(db, dataDir);

    const service = new SettingsBackupService(db, {
      dataDir,
      defaultDirectory: backupDir,
      now: () => new Date('2026-03-08T12:00:00.000Z'),
    });

    const backup = service.createBackup('manual');
    const sql = fs.readFileSync(backup.filePath, 'utf8');

    expect(sql).toContain("'auth_mode', 'none'");
    expect(sql).toContain("'validation_interval_minutes', '45'");
    expect(sql).toContain("'default_slack_channel', '#alerts'");
    expect(sql).not.toContain('https://secret-webhook.example.test/token');
    expect(sql).not.toContain('xoxb-default-secret');
    expect(sql).not.toContain('oidc-client-secret');
    expect(sql).not.toContain('arr-live-key');
    expect(sql).not.toContain('https://filter-webhook.example.test/token');
    expect(sql).not.toContain('xoxb-filter-secret');
    expect(sql).not.toContain('stored-password-hash');
    expect(sql).not.toContain('hashed-api-key');
    expect(sql).not.toContain('sensitive event');
    expect(sql).not.toContain('INSERT INTO "users"');
    expect(sql).not.toContain('INSERT INTO "sessions"');
    expect(sql).not.toContain('INSERT INTO "api_keys"');
    expect(sql).not.toContain('INSERT INTO "events"');
  });

  it('imports a backup while preserving non-sensitive settings and blanking secrets', () => {
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filtarr-backup-source-'));
    const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filtarr-backup-target-'));
    cleanupPaths.push(sourceRoot, targetRoot);

    const sourceDb = createDatabase();
    const targetDb = createDatabase();
    cleanupDbs.push(sourceDb, targetDb);

    seedDatabase(sourceDb, path.join(sourceRoot, 'data'));
    seedDatabase(targetDb, path.join(targetRoot, 'data'));
    insertSetting(targetDb, 'validation_interval_minutes', '5');

    const sourceService = new SettingsBackupService(sourceDb, {
      dataDir: path.join(sourceRoot, 'data'),
      defaultDirectory: path.join(sourceRoot, 'backups'),
      now: () => new Date('2026-03-08T12:30:00.000Z'),
    });
    const targetService = new SettingsBackupService(targetDb, {
      dataDir: path.join(targetRoot, 'data'),
      defaultDirectory: path.join(targetRoot, 'backups'),
      now: () => new Date('2026-03-08T12:45:00.000Z'),
    });

    const backup = sourceService.createBackup('manual');
    const sql = fs.readFileSync(backup.filePath, 'utf8');

    const result = targetService.importBackup(sql);

    expect(result.redactedSecretsRequireReentry).toBe(true);

    const settingsRows = targetDb
      .prepare<[string, string, string, string, string, string, string, string], { key: string; value: string }>(
        `SELECT key, value
         FROM settings
         WHERE key IN (?, ?, ?, ?, ?, ?, ?, ?)` ,
      )
      .all(
        'auth_mode',
        'validation_interval_minutes',
        'default_webhook_url',
        'default_slack_token',
        'default_slack_channel',
        'oidc_issuer_url',
        'oidc_client_id',
        'oidc_client_secret',
      );
    const settings = Object.fromEntries(settingsRows.map((row) => [row.key, row.value]));

    expect(settings['auth_mode']).toBe('none');
    expect(settings['validation_interval_minutes']).toBe('45');
    expect(settings['default_webhook_url']).toBe('');
    expect(settings['default_slack_token']).toBe('');
    expect(settings['default_slack_channel']).toBe('#alerts');
    expect(settings['oidc_issuer_url']).toBe('https://issuer.example.test/realms/filtarr');
    expect(settings['oidc_client_id']).toBe('filtarr-web');
    expect(settings['oidc_client_secret']).toBe('');

    const importedInstance = targetDb
      .prepare<[], { url: string; api_key_encrypted: string }>('SELECT url, api_key_encrypted FROM arr_instances')
      .get();
    expect(importedInstance?.url).toBe('http://sonarr.local');
    expect(decrypt(importedInstance?.api_key_encrypted ?? '', path.join(targetRoot, 'data'))).toBe('');

    const importedFilter = targetDb
      .prepare<[], { name: string; notify_webhook_url: string | null; notify_slack_token: string | null; notify_slack_channel: string | null }>(
        'SELECT name, notify_webhook_url, notify_slack_token, notify_slack_channel FROM filters',
      )
      .get();
    expect(importedFilter?.name).toBe('Episode Filter');
    expect(importedFilter?.notify_webhook_url).toBe('');
    expect(importedFilter?.notify_slack_token).toBe('');
    expect(importedFilter?.notify_slack_channel).toBe('#filter-alerts');

    expect(
      targetDb.prepare<[], { count: number }>('SELECT COUNT(*) as count FROM users').get()?.count,
    ).toBe(0);
    expect(
      targetDb.prepare<[], { count: number }>('SELECT COUNT(*) as count FROM sessions').get()?.count,
    ).toBe(0);
    expect(
      targetDb.prepare<[], { count: number }>('SELECT COUNT(*) as count FROM api_keys').get()?.count,
    ).toBe(0);
    expect(
      targetDb.prepare<[], { count: number }>('SELECT COUNT(*) as count FROM events').get()?.count,
    ).toBe(0);
    expect(
      targetDb.prepare<[], { count: number }>('SELECT COUNT(*) as count FROM jobs').get()?.count,
    ).toBe(1);
    expect(
      targetDb.prepare<[], { count: number }>('SELECT COUNT(*) as count FROM filter_instances').get()?.count,
    ).toBe(1);
  });
});