import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { runMigrations } from '../../src/db/migrate.js';
import { decrypt, encrypt, resetEncryptionKey } from '../../src/services/encryption.js';
import { SettingsBackupService, splitSqlStatements } from '../../src/server/services/settingsBackup.js';
import { resetConfigCache } from '../../src/config/index.js';
import { closeDatabase, openDatabase } from '../../src/db/index.js';
import { createApp } from '../../src/server/app.js';
import { markSetupComplete } from '../support/setupState.js';
import { SettingsBackupScheduler } from '../../src/server/cron/settingsBackup.js';

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

    // Auth mode and already-configured secrets survive a restore.
    expect(settings['auth_mode']).toBe('forms');
    expect(settings['validation_interval_minutes']).toBe('45');
    expect(settings['default_webhook_url']).toBe('https://secret-webhook.example.test/token');
    expect(settings['default_slack_token']).toBe('xoxb-default-secret');
    expect(settings['default_slack_channel']).toBe('#alerts');
    expect(settings['oidc_issuer_url']).toBe('https://issuer.example.test/realms/filtarr');
    expect(settings['oidc_client_id']).toBe('filtarr-web');
    expect(settings['oidc_client_secret']).toBe('oidc-client-secret');

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

    // Users, sessions, API keys, and events are never touched by a restore.
    expect(
      targetDb.prepare<[], { count: number }>('SELECT COUNT(*) as count FROM users').get()?.count,
    ).toBe(1);
    expect(
      targetDb.prepare<[], { count: number }>('SELECT COUNT(*) as count FROM sessions').get()?.count,
    ).toBe(1);
    expect(
      targetDb.prepare<[], { count: number }>('SELECT COUNT(*) as count FROM api_keys').get()?.count,
    ).toBe(1);
    expect(
      targetDb.prepare<[], { count: number }>('SELECT COUNT(*) as count FROM events').get()?.count,
    ).toBe(1);
    expect(
      targetDb.prepare<[], { count: number }>('SELECT COUNT(*) as count FROM jobs').get()?.count,
    ).toBe(1);
    expect(
      targetDb.prepare<[], { count: number }>('SELECT COUNT(*) as count FROM filter_instances').get()?.count,
    ).toBe(1);
  });

  it('blanks secrets on import when the target has none configured and leaves auth mode unset', () => {
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filtarr-backup-source-'));
    const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filtarr-backup-target-'));
    cleanupPaths.push(sourceRoot, targetRoot);

    const sourceDb = createDatabase();
    const targetDb = createDatabase();
    cleanupDbs.push(sourceDb, targetDb);
    seedDatabase(sourceDb, path.join(sourceRoot, 'data'));

    const sourceService = new SettingsBackupService(sourceDb, {
      dataDir: path.join(sourceRoot, 'data'),
      defaultDirectory: path.join(sourceRoot, 'backups'),
    });
    const targetService = new SettingsBackupService(targetDb, {
      dataDir: path.join(targetRoot, 'data'),
      defaultDirectory: path.join(targetRoot, 'backups'),
    });

    const sql = fs.readFileSync(sourceService.createBackup('manual').filePath, 'utf8');
    targetService.importBackup(sql);

    const get = (key: string) =>
      targetDb.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?').get(key)?.value;
    expect(get('auth_mode')).toBeUndefined();
    expect(get('default_webhook_url')).toBe('');
    expect(get('oidc_client_secret')).toBe('');
    expect(get('validation_interval_minutes')).toBe('45');
  });

  it('round-trips values containing semicolons, quotes, newlines, and comment markers', () => {
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filtarr-backup-source-'));
    const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filtarr-backup-target-'));
    cleanupPaths.push(sourceRoot, targetRoot);

    const sourceDb = createDatabase();
    const targetDb = createDatabase();
    cleanupDbs.push(sourceDb, targetDb);
    const { filterId } = seedDatabase(sourceDb, path.join(sourceRoot, 'data'));

    const scriptPayload = [
      "const name = 'O''Brien'; // it's fine;",
      '-- this line starts with a comment marker',
      '/* not a comment */ return name.includes(";");',
      "';DELETE FROM settings;--",
    ].join('\n');
    const regexPayload = '{"pattern":"^(a|b);\\\\s*--x$"}';
    const jobPayload = "a;b\n--c\n;'d'";
    const channel = "#it's;\n-- channel";
    sourceDb
      .prepare('UPDATE filters SET rule_payload = ?, action_payload = ? WHERE id = ?')
      .run(regexPayload, scriptPayload, filterId);
    sourceDb.prepare('UPDATE jobs SET payload = ?').run(jobPayload);
    insertSetting(sourceDb, 'default_slack_channel', channel);

    const sourceService = new SettingsBackupService(sourceDb, {
      dataDir: path.join(sourceRoot, 'data'),
      defaultDirectory: path.join(sourceRoot, 'backups'),
    });
    const targetService = new SettingsBackupService(targetDb, {
      dataDir: path.join(targetRoot, 'data'),
      defaultDirectory: path.join(targetRoot, 'backups'),
    });

    const sql = fs.readFileSync(sourceService.createBackup('manual').filePath, 'utf8');
    expect(() => targetService.importBackup(sql)).not.toThrow();

    const filter = targetDb
      .prepare<[], { rule_payload: string; action_payload: string }>('SELECT rule_payload, action_payload FROM filters')
      .get();
    expect(filter?.rule_payload).toBe(regexPayload);
    expect(filter?.action_payload).toBe(scriptPayload);
    expect(targetDb.prepare<[], { payload: string }>('SELECT payload FROM jobs').get()?.payload).toBe(jobPayload);
    expect(
      targetDb
        .prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?')
        .get('default_slack_channel')?.value,
    ).toBe(channel);
  });

  it('restores foreign key enforcement after import', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filtarr-backup-fk-'));
    cleanupPaths.push(rootDir);
    const db = createDatabase();
    cleanupDbs.push(db);
    seedDatabase(db, path.join(rootDir, 'data'));
    db.pragma('foreign_keys = ON');

    const service = new SettingsBackupService(db, {
      dataDir: path.join(rootDir, 'data'),
      defaultDirectory: path.join(rootDir, 'backups'),
    });
    service.importBackup(fs.readFileSync(service.createBackup('manual').filePath, 'utf8'));

    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.prepare<[], { count: number }>('SELECT COUNT(*) as count FROM users').get()?.count).toBe(1);
    expect(db.prepare<[], { count: number }>('SELECT COUNT(*) as count FROM directory_filters').get()?.count).toBe(1);
  });

  it('rejects disallowed statements even when hidden after a quoted semicolon', () => {
    const db = createDatabase();
    cleanupDbs.push(db);
    const service = new SettingsBackupService(db, { dataDir: os.tmpdir(), defaultDirectory: os.tmpdir() });

    expect(() =>
      service.importBackup("INSERT INTO settings (key, value) VALUES ('a', 'x;y'); DELETE FROM users;"),
    ).toThrow(/disallowed statement/);
    expect(() => service.importBackup("INSERT INTO settings (key, value) VALUES ('a', 'unterminated")).toThrow(
      /unterminated/,
    );
  });

  it('only prunes backup files written by the service', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filtarr-backup-prune-'));
    const backupDir = path.join(rootDir, 'backups');
    cleanupPaths.push(rootDir);
    fs.mkdirSync(backupDir, { recursive: true });
    const unrelated = path.join(backupDir, 'my-database-dump.sql');
    fs.writeFileSync(unrelated, '-- keep me');
    fs.utimesSync(unrelated, new Date('2020-01-01'), new Date('2020-01-01'));

    const db = createDatabase();
    cleanupDbs.push(db);
    insertSetting(db, 'backup_retention_count', '1');
    let current = new Date('2026-03-08T12:00:00.000Z');
    const service = new SettingsBackupService(db, {
      dataDir: path.join(rootDir, 'data'),
      defaultDirectory: backupDir,
      now: () => current,
    });

    const first = service.createBackup('manual');
    fs.utimesSync(first.filePath, new Date('2026-03-08'), new Date('2026-03-08'));
    current = new Date('2026-03-09T12:00:00.000Z');
    const second = service.createBackup('manual');

    expect(fs.readdirSync(backupDir).toSorted()).toEqual([second.fileName, 'my-database-dump.sql'].toSorted());
  });
});

describe('SettingsBackupScheduler', () => {
  it('re-arms when backups are enabled after starting disabled', () => {
    const db = createDatabase();
    insertSetting(db, 'backup_enabled', '0');
    const service = new SettingsBackupService(db, { dataDir: os.tmpdir(), defaultDirectory: os.tmpdir() });
    const scheduler = new SettingsBackupScheduler(db, service);

    try {
      scheduler.start();
      expect(scheduler.hasPendingRun()).toBe(false);

      service.updateSettings({ enabled: true });
      scheduler.reload();
      expect(scheduler.hasPendingRun()).toBe(true);

      service.updateSettings({ enabled: false });
      scheduler.reload();
      expect(scheduler.hasPendingRun()).toBe(false);
    } finally {
      scheduler.stop();
      db.close();
    }
  });
});

describe('splitSqlStatements', () => {
  it('splits only on semicolons outside of quotes and strips comments', () => {
    const sql = [
      '-- header comment',
      "INSERT INTO t VALUES ('a;b', 'it''s', 'x\n-- not a comment\ny');",
      'CREATE TABLE "we;ird" (id INTEGER); /* block; comment */',
      'PRAGMA foreign_keys=ON',
    ].join('\n');

    expect(splitSqlStatements(sql)).toEqual([
      "INSERT INTO t VALUES ('a;b', 'it''s', 'x\n-- not a comment\ny')",
      'CREATE TABLE "we;ird" (id INTEGER)',
      'PRAGMA foreign_keys=ON',
    ]);
  });
});

describe('settings backup import body limit', () => {
  let tempDir: string | undefined;
  let db: ReturnType<typeof openDatabase> | undefined;

  afterEach(() => {
    if (db) closeDatabase(db);
    db = undefined;
    resetConfigCache();
    delete process.env['FILTARR_DATA_DIR'];
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  function setup() {
    resetConfigCache();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filtarr-backup-limit-'));
    process.env['FILTARR_DATA_DIR'] = tempDir;
    const openedDb = openDatabase(tempDir);
    db = openedDb;
    markSetupComplete(openedDb);
    return { app: createApp(openedDb), db: openedDb, dataDir: tempDir };
  }

  it('accepts backup imports larger than the default 100kb JSON limit', async () => {
    const { app, db: appDb, dataDir } = setup();
    const service = new SettingsBackupService(appDb, {
      dataDir,
      defaultDirectory: path.join(dataDir, 'backups'),
    });
    const dump = fs.readFileSync(service.createBackup('manual').filePath, 'utf8');
    const sql = `-- ${'x'.repeat(300 * 1024)}\n${dump}`;

    const res = await request(app).post('/api/v1/settings/backup/import').send({ sql });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns a JSON error when the backup import body exceeds the limit', async () => {
    const { app } = setup();

    const res = await request(app)
      .post('/api/v1/settings/backup/import')
      .send({ sql: 'x'.repeat(11 * 1024 * 1024) });

    expect(res.status).toBe(413);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('keeps the default JSON limit for other routes', async () => {
    const { app } = setup();

    const res = await request(app)
      .put('/api/v1/settings/app')
      .send({ filler: 'x'.repeat(200 * 1024) });

    expect(res.status).toBe(413);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});