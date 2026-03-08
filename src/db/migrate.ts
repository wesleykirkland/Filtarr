import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface TableInfoRow {
  name: string;
}

const BASELINE_MIGRATION = '001_initial.sql';

function migrationWasApplied(db: Database.Database, migrationName: string): boolean {
  const migration = db
    .prepare<[string], { name: string }>('SELECT name FROM _migrations WHERE name = ? LIMIT 1')
    .get(migrationName);

  return Boolean(migration);
}

function tableHasColumn(db: Database.Database, tableName: string, columnName: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as TableInfoRow[];
  return columns.some((column) => column.name === columnName);
}

function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare<[string], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    )
    .get(tableName);

  return Boolean(row);
}

function ensureColumn(
  db: Database.Database,
  tableName: string,
  columnName: string,
  alterStatement: string,
): void {
  if (!tableExists(db, tableName) || tableHasColumn(db, tableName, columnName)) return;
  db.exec(alterStatement);
}

function repairLegacyFilterInstanceLinks(db: Database.Database): void {
  if (!tableExists(db, 'filters') || !tableExists(db, 'filter_instances')) return;

  db.exec(`
    UPDATE filters
    SET instance_id = (
      SELECT fi.instance_id
      FROM filter_instances fi
      WHERE fi.filter_id = filters.id
      ORDER BY fi.instance_id
      LIMIT 1
    )
    WHERE instance_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM filter_instances fi
        WHERE fi.filter_id = filters.id
      )
  `);

  db.exec(`
    INSERT INTO filters (
      name, description, trigger_source, rule_type, rule_payload,
      action_type, action_payload, target_path,
      is_built_in, notify_on_match, notify_webhook_url,
      notify_slack, notify_slack_token, notify_slack_channel,
      override_notifications, instance_id,
      enabled, sort_order, created_at, updated_at
    )
    SELECT
      f.name || ' (' || COALESCE(i.name, 'Instance ' || fi.instance_id) || ')',
      f.description,
      f.trigger_source,
      f.rule_type,
      f.rule_payload,
      f.action_type,
      f.action_payload,
      f.target_path,
      f.is_built_in,
      f.notify_on_match,
      f.notify_webhook_url,
      f.notify_slack,
      f.notify_slack_token,
      f.notify_slack_channel,
      f.override_notifications,
      fi.instance_id,
      f.enabled,
      f.sort_order,
      datetime('now'),
      datetime('now')
    FROM filter_instances fi
    INNER JOIN filters f ON f.id = fi.filter_id
    LEFT JOIN arr_instances i ON i.id = fi.instance_id
    WHERE fi.instance_id != (
      SELECT first_link.instance_id
      FROM filter_instances first_link
      WHERE first_link.filter_id = f.id
      ORDER BY first_link.instance_id
      LIMIT 1
    )
      AND NOT EXISTS (
        SELECT 1
        FROM filters existing
        WHERE existing.instance_id = fi.instance_id
          AND existing.name = f.name || ' (' || COALESCE(i.name, 'Instance ' || fi.instance_id) || ')'
      )
  `);
}

function repairLegacySchema(db: Database.Database): void {
  ensureColumn(
    db,
    'arr_instances',
    'skip_ssl_verify',
    'ALTER TABLE arr_instances ADD COLUMN skip_ssl_verify INTEGER NOT NULL DEFAULT 0;',
  );
  ensureColumn(db, 'arr_instances', 'remote_path', 'ALTER TABLE arr_instances ADD COLUMN remote_path TEXT;');
  ensureColumn(db, 'arr_instances', 'local_path', 'ALTER TABLE arr_instances ADD COLUMN local_path TEXT;');

  ensureColumn(db, 'filters', 'target_path', 'ALTER TABLE filters ADD COLUMN target_path TEXT;');
  ensureColumn(
    db,
    'filters',
    'is_built_in',
    'ALTER TABLE filters ADD COLUMN is_built_in INTEGER NOT NULL DEFAULT 0;',
  );
  ensureColumn(
    db,
    'filters',
    'notify_on_match',
    'ALTER TABLE filters ADD COLUMN notify_on_match INTEGER NOT NULL DEFAULT 0;',
  );
  ensureColumn(db, 'filters', 'notify_webhook_url', 'ALTER TABLE filters ADD COLUMN notify_webhook_url TEXT;');
  ensureColumn(
    db,
    'filters',
    'notify_slack',
    'ALTER TABLE filters ADD COLUMN notify_slack INTEGER NOT NULL DEFAULT 0;',
  );
  ensureColumn(db, 'filters', 'notify_slack_token', 'ALTER TABLE filters ADD COLUMN notify_slack_token TEXT;');
  ensureColumn(db, 'filters', 'notify_slack_channel', 'ALTER TABLE filters ADD COLUMN notify_slack_channel TEXT;');
  ensureColumn(
    db,
    'filters',
    'override_notifications',
    'ALTER TABLE filters ADD COLUMN override_notifications INTEGER NOT NULL DEFAULT 0;',
  );
  ensureColumn(
    db,
    'filters',
    'instance_id',
    'ALTER TABLE filters ADD COLUMN instance_id INTEGER REFERENCES arr_instances(id) ON DELETE CASCADE;',
  );

  if (tableExists(db, 'filters') && tableHasColumn(db, 'filters', 'notify_slack_enabled')) {
    db.exec(`
      UPDATE filters
      SET notify_slack = COALESCE(notify_slack_enabled, 0)
      WHERE COALESCE(notify_slack, 0) = 0
        AND COALESCE(notify_slack_enabled, 0) != 0
    `);
  }

  repairLegacyFilterInstanceLinks(db);

  if (tableExists(db, 'filters')) {
    db.exec(`
      UPDATE filters
      SET override_notifications = 1
      WHERE COALESCE(override_notifications, 0) = 0
        AND (
          COALESCE(notify_on_match, 0) != 0
          OR COALESCE(notify_slack, 0) != 0
          OR TRIM(COALESCE(notify_webhook_url, '')) != ''
          OR TRIM(COALESCE(notify_slack_token, '')) != ''
          OR TRIM(COALESCE(notify_slack_channel, '')) != ''
        )
    `);
  }
}

export function runMigrations(db: Database.Database): void {
  // Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const migrationsDir = path.join(__dirname, 'migrations');

  // In dev (tsx), look at src; in prod (compiled), look at dist
  const dirs = [migrationsDir, path.resolve(__dirname, '../../src/db/migrations')];

  let resolvedDir: string | null = null;
  for (const d of dirs) {
    if (fs.existsSync(d)) {
      resolvedDir = d;
      break;
    }
  }

  if (!resolvedDir) {
    console.log('No migrations directory found, skipping migrations.');
    return;
  }

  const baselinePath = path.join(resolvedDir, BASELINE_MIGRATION);
  if (!fs.existsSync(baselinePath)) {
    console.log(`Baseline migration ${BASELINE_MIGRATION} not found, skipping migrations.`);
    return;
  }

  const baselineSql = fs.readFileSync(baselinePath, 'utf-8');
  db.exec(baselineSql);

  if (!migrationWasApplied(db, BASELINE_MIGRATION)) {
    console.log(`Applying migration: ${BASELINE_MIGRATION}`);
    db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(BASELINE_MIGRATION);
  }

  repairLegacySchema(db);
}
