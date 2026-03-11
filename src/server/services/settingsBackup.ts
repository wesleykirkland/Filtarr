import SqliteDatabase from 'better-sqlite3';
import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../../config/index.js';
import { runMigrations } from '../../db/migrate.js';
import { encrypt } from '../../services/encryption.js';
import { logger } from '../lib/logger.js';

export interface BackupFileInfo {
  fileName: string;
  filePath: string;
  sizeBytes: number;
  createdAt: string;
}

export interface BackupSettingsState {
  enabled: boolean;
  directory: string;
  retentionCount: number;
  frequency: 'daily';
  lastBackupAt: string | null;
  nextBackupAt: string | null;
  lastError: string | null;
  backups: BackupFileInfo[];
}

export interface BackupImportResult {
  restoredAt: string;
  redactedSecretsRequireReentry: boolean;
}

interface SqliteSchemaRow {
  type: 'table' | 'index' | 'trigger';
  name: string;
  sql: string;
}

interface TableColumnRow {
  name: string;
}

interface SettingsBackupServiceOptions {
  dataDir?: string;
  defaultDirectory?: string;
  now?: () => Date;
}

const DEFAULT_BACKUP_DIRECTORY = '/config/backup';
const DEFAULT_RETENTION_COUNT = 30;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const EXPORT_TABLES = [
  'settings',
  'events',
  'users',
  'sessions',
  'api_keys',
  'arr_instances',
  'directories',
  'filters',
  'jobs',
  'filter_instances',
  'directory_filters',
] as const;
const TABLES_WITHOUT_EXPORTED_ROWS = new Set(['events', 'users', 'sessions', 'api_keys']);
const BLANKED_SETTING_KEYS = new Set(['default_webhook_url', 'default_slack_token', 'oidc_client_secret']);
const REDACTION_NOTES = [
  'settings.default_webhook_url => blank',
  'settings.default_slack_token => blank',
  'settings.oidc_client_secret => blank',
  'settings.auth_mode => forced to none',
  'arr_instances.api_key_encrypted => blank placeholder',
  'filters.notify_webhook_url => blank',
  'filters.notify_slack_token => blank',
  'users, sessions, api_keys, and events rows => omitted',
] as const;

export class SettingsBackupService {
  private readonly dataDir: string;
  private readonly defaultDirectory: string;
  private readonly now: () => Date;

  constructor(
    private readonly db: Database.Database,
    options: SettingsBackupServiceOptions = {},
  ) {
    this.dataDir = options.dataDir ?? getConfig().dataDir;
    this.defaultDirectory = options.defaultDirectory ?? DEFAULT_BACKUP_DIRECTORY;
    this.now = options.now ?? (() => new Date());
  }

  public getState(): BackupSettingsState {
    const directory = this.getDirectorySetting();
    const backups = this.listBackups(directory);
    const lastBackupAt = this.getLatestTimestamp(this.getSettingValue('backup_last_run_at'), backups[0]?.createdAt);
    const enabled = this.getBooleanSetting('backup_enabled', true);

    return {
      enabled,
      directory,
      retentionCount: this.getPositiveIntegerSetting('backup_retention_count', DEFAULT_RETENTION_COUNT),
      frequency: 'daily',
      lastBackupAt,
      nextBackupAt: enabled ? this.getNextBackupAt(lastBackupAt) : null,
      lastError: this.getNullableSetting('backup_last_error'),
      backups,
    };
  }

  public updateSettings(input: {
    enabled?: boolean;
    directory?: string;
    retentionCount?: number;
  }): BackupSettingsState {
    if (input.enabled !== undefined) {
      this.upsertSetting('backup_enabled', input.enabled ? '1' : '0');
    }

    if (input.directory !== undefined) {
      this.upsertSetting('backup_directory', this.normalizeDirectory(input.directory));
    }

    if (input.retentionCount !== undefined) {
      if (!Number.isInteger(input.retentionCount) || input.retentionCount < 1) {
        throw new Error('Backup retention count must be a positive integer');
      }

      this.upsertSetting('backup_retention_count', String(input.retentionCount));
    }

    return this.getState();
  }

  public isBackupDue(referenceDate: Date = this.now()): boolean {
    const state = this.getState();

    if (!state.enabled) return false;
    if (!state.lastBackupAt) return true;

    const lastRunMs = Date.parse(state.lastBackupAt);
    if (Number.isNaN(lastRunMs)) return true;

    return referenceDate.getTime() - lastRunMs >= ONE_DAY_MS;
  }

  public createBackup(reason: 'manual' | 'scheduled' = 'manual'): BackupFileInfo {
    const state = this.getState();
    const createdAt = this.now().toISOString();
    const sql = this.createRedactedDump(createdAt, reason);
    const directory = state.directory;

    try {
      fs.mkdirSync(directory, { recursive: true });

      const fileName = `filtarr-settings-${this.formatFileTimestamp(createdAt)}.sql`;
      const filePath = path.join(directory, fileName);
      fs.writeFileSync(filePath, sql, 'utf8');

      this.upsertSetting('backup_last_run_at', createdAt);
      this.upsertSetting('backup_last_error', '');
      this.pruneBackups(directory, state.retentionCount);

      const stats = fs.statSync(filePath);
      logger.info({ filePath, reason }, 'Created redacted settings backup');

      return {
        fileName,
        filePath,
        sizeBytes: stats.size,
        createdAt: stats.mtime.toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown backup failure';
      this.upsertSetting('backup_last_error', message);
      logger.error({ err: error, directory, reason }, 'Failed to create redacted settings backup');
      throw error;
    }
  }

  public importBackup(sql: string): BackupImportResult {
    if (!sql.trim()) {
      throw new Error('Backup SQL is required');
    }

    const tempDb = new SqliteDatabase(':memory:');

    try {
      tempDb.pragma('foreign_keys = OFF');
      tempDb.exec(sql);
      runMigrations(tempDb);
      this.restoreFromDatabase(tempDb);

      return {
        restoredAt: this.now().toISOString(),
        redactedSecretsRequireReentry: true,
      };
    } catch (error) {
      logger.warn({ err: error }, 'Failed to import settings backup');
      throw new Error('Backup SQL could not be imported');
    } finally {
      tempDb.close();
    }
  }

  public static getRedactionNotes(): readonly string[] {
    return REDACTION_NOTES;
  }

  private restoreFromDatabase(sourceDb: Database.Database): void {
    const deleteOrder = [...EXPORT_TABLES].reverse();
    const insertOrder = [...EXPORT_TABLES];

    const restore = this.db.transaction(() => {
      this.db.pragma('foreign_keys = OFF');

      for (const table of deleteOrder) {
        this.db.prepare(`DELETE FROM ${this.quoteIdentifier(table)}`).run();
      }

      for (const table of insertOrder) {
        const columns = this.getTableColumns(sourceDb, table);
        if (columns.length === 0) continue;

        const rows = sourceDb
          .prepare(`SELECT * FROM ${this.quoteIdentifier(table)}`)
          .all() as Array<Record<string, unknown>>;

        for (const row of rows) {
          const normalizedRow = this.normalizeImportedRow(table, row);
          const placeholders = columns.map(() => '?').join(', ');
          const columnList = columns.map((column) => this.quoteIdentifier(column)).join(', ');
          const values = columns.map((column) => normalizedRow[column]);

          this.db
            .prepare(
              `INSERT INTO ${this.quoteIdentifier(table)} (${columnList}) VALUES (${placeholders})`,
            )
            .run(...values);
        }
      }

      this.db.pragma('foreign_keys = ON');
    });

    restore();
  }

  private createRedactedDump(createdAt: string, reason: 'manual' | 'scheduled'): string {
    const tables = this.getSchemaRows('table');
    const secondaryObjects = [...this.getSchemaRows('index'), ...this.getSchemaRows('trigger')];
    const lines = [
      '-- Filtarr redacted settings backup',
      `-- Created at: ${createdAt}`,
      `-- Reason: ${reason}`,
      '-- Sensitive values are intentionally blanked and must be re-entered after import.',
      ...REDACTION_NOTES.map((note) => `-- ${note}`),
      'PRAGMA foreign_keys=OFF;',
      'BEGIN TRANSACTION;',
    ];

    for (const table of tables) {
      lines.push(`${table.sql};`);
    }

    for (const table of EXPORT_TABLES) {
      const columns = this.getTableColumns(this.db, table);
      if (columns.length === 0 || TABLES_WITHOUT_EXPORTED_ROWS.has(table)) continue;

      const rows = this.db
        .prepare(`SELECT * FROM ${this.quoteIdentifier(table)}`)
        .all() as Array<Record<string, unknown>>;

      for (const row of rows) {
        const redactedRow = this.redactExportRow(table, row);
        const values = columns.map((column) => this.toSqlLiteral(redactedRow[column]));
        const columnList = columns.map((column) => this.quoteIdentifier(column)).join(', ');

        lines.push(
          `INSERT INTO ${this.quoteIdentifier(table)} (${columnList}) VALUES (${values.join(', ')});`,
        );
      }
    }

    for (const object of secondaryObjects) {
      lines.push(`${object.sql};`);
    }

    lines.push('COMMIT;', 'PRAGMA foreign_keys=ON;', '');
    return lines.join('\n');
  }

  private redactExportRow(table: (typeof EXPORT_TABLES)[number], row: Record<string, unknown>) {
    if (table === 'settings') {
      const key = String(row['key'] ?? '');
      if (key === 'auth_mode') {
        return { ...row, value: 'none' };
      }

      if (key === 'backup_last_error' || BLANKED_SETTING_KEYS.has(key)) {
        return { ...row, value: '' };
      }

      return row;
    }

    if (table === 'arr_instances') {
      return { ...row, api_key_encrypted: '' };
    }

    if (table === 'filters') {
      return {
        ...row,
        notify_webhook_url: '',
        notify_slack_token: '',
      };
    }

    return row;
  }

  private normalizeImportedRow(table: (typeof EXPORT_TABLES)[number], row: Record<string, unknown>) {
    if (table === 'settings') {
      const key = String(row['key'] ?? '');

      if (key === 'auth_mode') {
        return { ...row, value: 'none' };
      }

      if (key === 'backup_last_error' || BLANKED_SETTING_KEYS.has(key)) {
        return { ...row, value: '' };
      }

      return row;
    }

    if (table === 'arr_instances') {
      const encryptedPlaceholder =
        typeof row['api_key_encrypted'] === 'string' && row['api_key_encrypted'].trim().length > 0
          ? row['api_key_encrypted']
          : encrypt('', this.dataDir);

      return { ...row, api_key_encrypted: encryptedPlaceholder };
    }

    if (table === 'filters') {
      return {
        ...row,
        notify_webhook_url: '',
        notify_slack_token: '',
      };
    }

    return row;
  }

  private getSchemaRows(type: SqliteSchemaRow['type']): SqliteSchemaRow[] {
    return this.db
      .prepare<
        [SqliteSchemaRow['type']],
        SqliteSchemaRow
      >(
        `SELECT type, name, sql
         FROM sqlite_master
         WHERE type = ?
           AND sql IS NOT NULL
           AND name NOT LIKE 'sqlite_%'
           AND name != '_migrations'
         ORDER BY name`,
      )
      .all(type)
      .filter((row) => EXPORT_TABLES.includes(row.name as (typeof EXPORT_TABLES)[number]));
  }

  private getTableColumns(db: Database.Database, tableName: (typeof EXPORT_TABLES)[number]): string[] {
    return (db.prepare(`PRAGMA table_info(${this.quoteIdentifier(tableName)})`).all() as TableColumnRow[]).map(
      (column) => column.name,
    );
  }

  private listBackups(directory: string): BackupFileInfo[] {
    if (!fs.existsSync(directory)) return [];

    return fs
      .readdirSync(directory)
      .filter((entry) => entry.endsWith('.sql'))
      .map((fileName) => {
        const filePath = path.join(directory, fileName);
        const stats = fs.statSync(filePath);

        return {
          fileName,
          filePath,
          sizeBytes: stats.size,
          createdAt: stats.mtime.toISOString(),
        };
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  private pruneBackups(directory: string, retentionCount: number): void {
    const backups = this.listBackups(directory);
    backups.slice(retentionCount).forEach((backup) => fs.rmSync(backup.filePath));
  }

  private getNextBackupAt(lastBackupAt: string | null): string {
    if (!lastBackupAt) {
      return new Date(this.now().getTime() + ONE_DAY_MS).toISOString();
    }

    const lastRunMs = Date.parse(lastBackupAt);
    if (Number.isNaN(lastRunMs)) {
      return new Date(this.now().getTime() + ONE_DAY_MS).toISOString();
    }

    return new Date(lastRunMs + ONE_DAY_MS).toISOString();
  }

  private getLatestTimestamp(...timestamps: Array<string | undefined>): string | null {
    const valid = timestamps
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value))
      .filter((value) => !Number.isNaN(Date.parse(value)));

    if (valid.length === 0) return null;
    return valid.sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
  }

  private getNullableSetting(key: string): string | null {
    const value = this.getSettingValue(key)?.trim();
    return value ? value : null;
  }

  private getDirectorySetting(): string {
    return this.normalizeDirectory(this.getSettingValue('backup_directory') ?? this.defaultDirectory);
  }

  private normalizeDirectory(directory: string): string {
    const trimmed = directory.trim();
    return trimmed.length > 0 ? trimmed : this.defaultDirectory;
  }

  private getPositiveIntegerSetting(key: string, defaultValue: number): number {
    const rawValue = this.getSettingValue(key);
    if (!rawValue) return defaultValue;

    const parsedValue = Number.parseInt(rawValue, 10);
    return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : defaultValue;
  }

  private getBooleanSetting(key: string, defaultValue: boolean): boolean {
    const value = this.getSettingValue(key);
    if (value === undefined) return defaultValue;
    return value === '1';
  }

  private getSettingValue(key: string): string | undefined {
    return this.db.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?').get(key)
      ?.value;
  }

  private upsertSetting(key: string, value: string): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO settings (key, value, updated_at)
       VALUES (?, ?, datetime('now'))`,
    ).run(key, value);
  }

  private toSqlLiteral(value: unknown): string {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
    if (typeof value === 'bigint') return value.toString();
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  private quoteIdentifier(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
  }

  private formatFileTimestamp(isoString: string): string {
    return isoString.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace('T', '-').replace('Z', '');
  }
}