import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { getAllDirectories } from '../../src/db/schemas/directories.js';

function getTableNames(db: Database.Database): string[] {
  return (db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as Array<{ name: string }>).map((table) => table.name);
}

function getColumnNames(db: Database.Database, tableName: string): string[] {
  return (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map(
    (column) => column.name,
  );
}

function getMigrationNames(db: Database.Database): string[] {
  return (db.prepare('SELECT name FROM _migrations ORDER BY name').all() as Array<{ name: string }>).map(
    (migration) => migration.name,
  );
}

describe('database migrations', () => {
  it('applies the consolidated baseline schema to a fresh database', () => {
    const db = new Database(':memory:');

    try {
      runMigrations(db);

      expect(getTableNames(db)).toEqual(
        expect.arrayContaining([
          '_migrations',
          'api_keys',
          'arr_instances',
          'directories',
          'directory_filters',
          'events',
          'filter_instances',
          'filters',
          'jobs',
          'sessions',
          'settings',
          'users',
        ]),
      );
      expect(getColumnNames(db, 'filters')).toEqual(
        expect.arrayContaining([
          'target_path',
          'is_built_in',
          'notify_on_match',
          'notify_webhook_url',
          'notify_slack',
          'notify_slack_token',
          'notify_slack_channel',
          'override_notifications',
          'instance_id',
        ]),
      );
      expect(getColumnNames(db, 'arr_instances')).toEqual(
        expect.arrayContaining(['skip_ssl_verify', 'remote_path', 'local_path']),
      );
      expect(getMigrationNames(db)).toEqual(['001_initial.sql']);
      expect(() => getAllDirectories(db)).not.toThrow();
      expect(getAllDirectories(db)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('upgrades legacy unified notification migrations without duplicating slack columns', () => {
    const db = new Database(':memory:');

    try {
      db.exec(`
        CREATE TABLE filters (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          description TEXT,
          trigger_source TEXT NOT NULL,
          rule_type TEXT NOT NULL,
          rule_payload TEXT NOT NULL,
          action_type TEXT NOT NULL,
          action_payload TEXT,
          target_path TEXT,
          is_built_in INTEGER NOT NULL DEFAULT 0,
          notify_on_match INTEGER NOT NULL DEFAULT 0,
          notify_webhook_url TEXT,
          notify_slack_enabled INTEGER DEFAULT 0,
          notify_slack_token TEXT,
          notify_slack_channel TEXT,
          instance_id INTEGER,
          enabled INTEGER NOT NULL DEFAULT 1,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE _migrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);

      const appliedMigrations = [
        '001_initial.sql',
        '002_auth_tables.sql',
        '003_instances.sql',
        '004_instances_ssl.sql',
        '005_validation_schedule.sql',
        '006_directories_filters_cron.sql',
        '007_filter_path_builtin.sql',
        '008_filter_instances.sql',
        '009_filter_notifications.sql',
        '010_instance_path_mapping.sql',
        '011_filter_instance_1to1.sql',
        '012_global_notifications.sql',
        '013_unified_notifications.sql',
      ];

      const insertMigration = db.prepare('INSERT INTO _migrations (name) VALUES (?)');
      for (const migrationName of appliedMigrations) {
        insertMigration.run(migrationName);
      }

      db.prepare(
        `INSERT INTO filters (
           name, description, trigger_source, rule_type, rule_payload,
           action_type, action_payload, target_path,
           is_built_in, notify_on_match, notify_webhook_url,
           notify_slack_enabled, notify_slack_token, notify_slack_channel,
           instance_id, enabled, sort_order, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      ).run(
        'Legacy Slack Filter',
        'Created before the merged migration rename',
        'watcher',
        'extension',
        'exe',
        'notify',
        null,
        null,
        0,
        1,
        'https://example.com/webhook',
        1,
        'xoxb-legacy-token',
        '#legacy-alerts',
        null,
        1,
        0,
      );

      expect(() => runMigrations(db)).not.toThrow();

      expect(getColumnNames(db, 'filters')).toEqual(
        expect.arrayContaining([
          'notify_slack',
          'notify_slack_token',
          'notify_slack_channel',
          'override_notifications',
        ]),
      );

      const legacyFilter = db
        .prepare(
          'SELECT notify_slack, notify_slack_token, notify_slack_channel, override_notifications FROM filters WHERE name = ?',
        )
        .get('Legacy Slack Filter') as {
        notify_slack: number;
        notify_slack_token: string;
        notify_slack_channel: string;
        override_notifications: number;
      };

      expect(legacyFilter.notify_slack).toBe(1);
      expect(legacyFilter.notify_slack_token).toBe('xoxb-legacy-token');
      expect(legacyFilter.notify_slack_channel).toBe('#legacy-alerts');
      expect(legacyFilter.override_notifications).toBe(1);

      expect(getTableNames(db)).toContain('directories');
      expect(() => getAllDirectories(db)).not.toThrow();
      expect(getMigrationNames(db)).toEqual(appliedMigrations);
    } finally {
      db.close();
    }
  });

  it('repairs legacy filter instance links idempotently during consolidation', () => {
    const db = new Database(':memory:');

    try {
      db.exec(`
        CREATE TABLE arr_instances (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('sonarr', 'radarr', 'lidarr', 'readarr')),
          url TEXT NOT NULL,
          api_key_encrypted TEXT NOT NULL,
          timeout INTEGER NOT NULL DEFAULT 30000,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE filters (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          description TEXT,
          trigger_source TEXT NOT NULL,
          rule_type TEXT NOT NULL,
          rule_payload TEXT NOT NULL,
          action_type TEXT NOT NULL,
          action_payload TEXT,
          target_path TEXT,
          is_built_in INTEGER NOT NULL DEFAULT 0,
          notify_on_match INTEGER NOT NULL DEFAULT 0,
          notify_webhook_url TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE filter_instances (
          filter_id INTEGER NOT NULL REFERENCES filters(id) ON DELETE CASCADE,
          instance_id INTEGER NOT NULL REFERENCES arr_instances(id) ON DELETE CASCADE,
          PRIMARY KEY (filter_id, instance_id)
        );

        CREATE TABLE _migrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);

      const appliedMigrations = [
        '001_initial.sql',
        '002_auth_tables.sql',
        '003_instances.sql',
        '004_instances_ssl.sql',
        '005_validation_schedule.sql',
        '006_directories_filters_cron.sql',
        '007_filter_path_builtin.sql',
        '008_filter_instances.sql',
        '009_filter_notifications.sql',
        '010_instance_path_mapping.sql',
      ];

      const insertMigration = db.prepare('INSERT INTO _migrations (name) VALUES (?)');
      for (const migrationName of appliedMigrations) {
        insertMigration.run(migrationName);
      }

      db.prepare(
        `INSERT INTO arr_instances (name, type, url, api_key_encrypted, timeout, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      ).run('Sonarr Main', 'sonarr', 'http://localhost:8989', 'encrypted-1', 30000, 1);

      db.prepare(
        `INSERT INTO arr_instances (name, type, url, api_key_encrypted, timeout, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      ).run('Radarr Main', 'radarr', 'http://localhost:7878', 'encrypted-2', 30000, 1);

      db.prepare(
        `INSERT INTO filters (
           name, description, trigger_source, rule_type, rule_payload,
           action_type, action_payload, target_path,
           is_built_in, notify_on_match, notify_webhook_url,
           enabled, sort_order, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      ).run(
        'Multi Instance Filter',
        'Migrated from the legacy filter_instances table',
        'manual',
        'extension',
        'msi',
        'blocklist',
        null,
        '/downloads',
        0,
        1,
        'https://example.com/partial-webhook',
        1,
        0,
      );

      db.exec(`
        INSERT INTO filter_instances (filter_id, instance_id) VALUES (1, 1);
        INSERT INTO filter_instances (filter_id, instance_id) VALUES (1, 2);
      `);

      expect(() => runMigrations(db)).not.toThrow();
      expect(() => runMigrations(db)).not.toThrow();

      const filters = db
        .prepare('SELECT name, instance_id FROM filters ORDER BY id')
        .all() as Array<{ name: string; instance_id: number | null }>;

      expect(filters).toEqual([
        { name: 'Multi Instance Filter', instance_id: 1 },
        { name: 'Multi Instance Filter (Radarr Main)', instance_id: 2 },
      ]);
    } finally {
      db.close();
    }
  });
});
