import SqliteDatabase from 'better-sqlite3';
import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../../config/index.js';
import { runMigrations } from '../../db/migrate.js';
import {
  decryptStoredSecret,
  encrypt,
  encryptStoredSecret,
  isEncryptedStoredSecret,
} from '../../services/encryption.js';
import { customScriptsEnabled } from '../../services/security.js';
import { OidcAuthConfigSchema } from '../../config/auth.js';
import { logger } from '../lib/logger.js';
import { createFilterSchema } from '../routes/filters.js';
import { createJobSchema } from '../routes/jobs.js';

/** Raised when a backup import is rejected by validation; safe to show to the client. */
export class BackupImportValidationError extends Error {
  constructor(message: string) {
    super(`Backup import rejected: ${message}`);
    this.name = 'BackupImportValidationError';
  }
}

/** Raised when the configured backup directory is not inside the data directory. */
export class BackupDirectoryError extends Error {
  constructor() {
    super('Backup directory must be inside the Filtarr data directory');
    this.name = 'BackupDirectoryError';
  }
}

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

const DEFAULT_BACKUP_SUBDIRECTORY = 'backup';
const DEFAULT_RETENTION_COUNT = 30;
const BACKUP_DIRECTORY_ERROR_MESSAGE = 'Backup directory is not inside the Filtarr data directory';
const BACKUP_WRITE_ERROR_MESSAGE = 'Backup failed; check the server logs for details';
const KNOWN_BACKUP_ERRORS = new Set([BACKUP_DIRECTORY_ERROR_MESSAGE, BACKUP_WRITE_ERROR_MESSAGE]);
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
const BLANKED_SETTING_KEYS = new Set([
  'default_webhook_url',
  'default_slack_token',
  'oidc_client_secret',
  'slack_webhook_url',
]);
/**
 * The only settings keys an import may write. Everything else in the live
 * settings table (setup_complete, auth_mode, backup bookkeeping, unknown keys)
 * is left untouched, and anything else in the backup is ignored.
 */
const RESTORABLE_SETTING_KEYS = new Set([
  'validation_interval_minutes',
  'slack_enabled',
  'webhook_enabled',
  'default_slack_channel',
  'oidc_issuer_url',
  'oidc_client_id',
  'oidc_callback_url',
  'oidc_scopes',
  'backup_enabled',
  'backup_directory',
  'backup_retention_count',
  ...BLANKED_SETTING_KEYS,
]);
const REDACTION_NOTES = [
  'settings.default_webhook_url => blank',
  'settings.default_slack_token => blank',
  'settings.oidc_client_secret => blank',
  'settings.slack_webhook_url => blank',
  'settings.auth_mode => exported as none; not restored (current auth mode is kept on import)',
  'arr_instances.api_key_encrypted => blank placeholder; always blanked on import, so API keys must be re-entered',
  'filters.notify_webhook_url => blank; always blanked on import',
  'filters.notify_slack_token => blank; always blanked on import',
  'users, sessions, api_keys, and events rows => omitted from export and left untouched on import',
  `only these settings keys are restored on import: ${[...RESTORABLE_SETTING_KEYS].join(', ')}; all other settings (including setup_complete and auth_mode) are left untouched`,
  'blank secret settings in a backup do not overwrite secrets already configured on import',
  'non-blank secret settings in a backup are re-encrypted with this server\'s key on import (undecryptable values are ignored)',
  'imported filters and jobs are validated like API input; custom-script filters and jobs require FILTARR_ENABLE_CUSTOM_SCRIPTS=true',
] as const;
const BACKUP_FILE_PATTERN = /^filtarr-settings-\d{8}-\d{6}\.sql$/;

const BOOLEAN_SETTING_KEYS = new Set(['slack_enabled', 'webhook_enabled', 'backup_enabled']);

/**
 * Apply the same value rules the settings routes enforce. Returns false for a
 * value the corresponding API route would reject. Keys without rules are
 * free-form strings. (backup_directory containment is checked separately.)
 */
export function validateSettingValue(key: string, value: unknown): boolean {
  if (typeof value !== 'string') return false;

  if (key === 'validation_interval_minutes') {
    const minutes = Number(value);
    return value.trim() !== '' && Number.isFinite(minutes) && minutes >= 1;
  }

  if (key === 'backup_retention_count') {
    return /^\d+$/.test(value) && Number.parseInt(value, 10) >= 1;
  }

  if (BOOLEAN_SETTING_KEYS.has(key)) {
    return value === '0' || value === '1';
  }

  if (key === 'oidc_issuer_url') {
    return value === '' || OidcAuthConfigSchema.shape.issuerUrl.safeParse(value).success;
  }

  if (key === 'oidc_callback_url') {
    return value === '' || OidcAuthConfigSchema.shape.callbackUrl.safeParse(value).success;
  }

  return true;
}

function isPathInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** Realpath of the nearest existing ancestor, re-joined with the missing tail. */
function realpathOfNearestAncestor(target: string): string {
  let current = target;
  const missing: string[] = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    missing.unshift(path.basename(current));
    current = parent;
  }
  return path.join(fs.realpathSync(current), ...missing);
}

function toOptional(value: unknown): unknown {
  return value === null ? undefined : value;
}

function toOptionalBoolean(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  return typeof value === 'number' ? value !== 0 : value;
}

/**
 * Split a SQL script into statements on `;`, honouring SQLite quoting rules.
 * Semicolons and comment markers inside single-quoted strings (where `''`
 * escapes a quote), double-quoted identifiers, backtick or bracket-quoted
 * identifiers are treated as literal text. `--` line comments and `/* *\/`
 * block comments outside of quotes are removed. Empty statements are dropped.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;
  const length = sql.length;

  const closingQuote: Record<string, string> = { "'": "'", '"': '"', '`': '`', '[': ']' };

  while (i < length) {
    const char = sql[i] as string;
    const next = sql[i + 1];

    if (char in closingQuote) {
      const close = closingQuote[char] as string;
      let j = i + 1;
      while (j < length) {
        if (sql[j] === close) {
          // Doubled quote is an escaped quote (not applicable to [...] identifiers).
          if (close !== ']' && sql[j + 1] === close) {
            j += 2;
            continue;
          }
          break;
        }
        j += 1;
      }
      if (j >= length) {
        throw new Error('Backup SQL contains an unterminated quoted value');
      }
      current += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }

    if (char === '-' && next === '-') {
      const newline = sql.indexOf('\n', i);
      i = newline === -1 ? length : newline;
      continue;
    }

    if (char === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) {
        throw new Error('Backup SQL contains an unterminated comment');
      }
      current += ' ';
      i = end + 2;
      continue;
    }

    if (char === ';') {
      const trimmed = current.trim();
      if (trimmed.length > 0) statements.push(trimmed);
      current = '';
      i += 1;
      continue;
    }

    current += char;
    i += 1;
  }

  const trailing = current.trim();
  if (trailing.length > 0) statements.push(trailing);

  return statements;
}

export class SettingsBackupService {
  private readonly dataDir: string;
  private readonly defaultDirectory: string;
  private readonly now: () => Date;

  constructor(
    private readonly db: Database.Database,
    options: SettingsBackupServiceOptions = {},
  ) {
    this.dataDir = options.dataDir ?? getConfig().dataDir;
    this.defaultDirectory =
      options.defaultDirectory ?? path.join(this.dataDir, DEFAULT_BACKUP_SUBDIRECTORY);
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
      lastError: this.getLastError(),
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
      this.upsertSetting('backup_directory', this.resolveBackupDirectory(input.directory, true));
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
    let directory = state.directory;

    try {
      directory = this.resolveBackupDirectory(directory, true);
    } catch (error) {
      this.upsertSetting('backup_last_error', BACKUP_DIRECTORY_ERROR_MESSAGE);
      logger.error({ err: error, directory, reason }, 'Refusing to write backup outside the data directory');
      throw error;
    }

    try {
      const fileName = `filtarr-settings-${this.formatFileTimestamp(createdAt)}.sql`;
      const filePath = path.join(directory, fileName);
      fs.writeFileSync(filePath, sql, { encoding: 'utf8', mode: 0o600 });
      fs.chmodSync(filePath, 0o600);

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
      this.upsertSetting('backup_last_error', BACKUP_WRITE_ERROR_MESSAGE);
      logger.error({ err: error, directory, reason }, 'Failed to create redacted settings backup');
      throw error;
    }
  }

  public importBackup(sql: string): BackupImportResult {
    if (!sql.trim()) {
      throw new Error('Backup SQL is required');
    }

    const validatedStatements = SettingsBackupService.parseAndValidateBackupSql(sql);

    const tempDb = new SqliteDatabase(':memory:');

    try {
      tempDb.pragma('foreign_keys = OFF');
      for (const stmt of validatedStatements) {
        tempDb.exec(stmt);
      }
      runMigrations(tempDb);
      this.validateImportedData(tempDb);
      this.restoreFromDatabase(tempDb);

      return {
        restoredAt: this.now().toISOString(),
        redactedSecretsRequireReentry: true,
      };
    } catch (error) {
      logger.warn({ err: error }, 'Failed to import settings backup');
      if (error instanceof BackupImportValidationError) throw error;
      throw new Error('Backup SQL could not be imported', { cause: error });
    } finally {
      tempDb.close();
    }
  }

  public static getRedactionNotes(): readonly string[] {
    return REDACTION_NOTES;
  }

  /**
   * Allowlist pattern for SQL statements permitted in backup imports.
   * Only CREATE TABLE/INDEX/TRIGGER, INSERT INTO, PRAGMA, BEGIN, and
   * COMMIT are accepted.  Every other statement type is rejected.
   */
  private static readonly ALLOWED_STATEMENT =
    /^(CREATE\s+(TABLE|INDEX|TRIGGER)\b|INSERT\s+INTO\b|PRAGMA\b|BEGIN\b|COMMIT\b)/i;

  /**
   * Parse backup SQL into individual statements (quote-aware, comments
   * stripped outside of literals) and validate each statement against the
   * allowlist.  Returns the array of validated statements so the caller never
   * passes raw user input to `exec()`.
   */
  private static parseAndValidateBackupSql(sql: string): string[] {
    const statements = splitSqlStatements(sql);

    for (const stmt of statements) {
      if (!SettingsBackupService.ALLOWED_STATEMENT.test(stmt)) {
        throw new Error('Backup SQL contains disallowed statement: ' + stmt.slice(0, 80));
      }
    }

    return statements;
  }

  /**
   * Validate every imported filter, job, and settings row with the same rules
   * as the API routes before anything is copied into the live database.
   * Throws a BackupImportValidationError naming the first offending row.
   */
  private validateImportedData(sourceDb: Database.Database): void {
    const scriptsAllowed = customScriptsEnabled();

    const filters = this.selectAll(sourceDb, 'filters');
    filters.forEach((row, index) => {
      const label = `filters row ${index + 1}`;
      const parsed = createFilterSchema.safeParse({
        name: row['name'],
        description: toOptional(row['description']),
        triggerSource: row['trigger_source'],
        ruleType: row['rule_type'],
        rulePayload: row['rule_payload'],
        actionType: row['action_type'],
        actionPayload: toOptional(row['action_payload']),
        scriptRuntime: toOptional(row['script_runtime']),
        targetPath: toOptional(row['target_path']),
        notifyOnMatch: toOptionalBoolean(row['notify_on_match']),
        // Per-filter notification secrets are always blanked on import.
        notifyWebhookUrl: '',
        notifySlack: toOptionalBoolean(row['notify_slack']),
        notifySlackToken: '',
        notifySlackChannel: toOptional(row['notify_slack_channel']),
        overrideNotifications: toOptionalBoolean(row['override_notifications']),
        instanceId: toOptional(row['instance_id']),
        enabled: toOptionalBoolean(row['enabled']),
        sortOrder: toOptional(row['sort_order']),
      });
      if (!parsed.success) {
        const field = parsed.error.issues[0]?.path.join('.') || 'row';
        throw new BackupImportValidationError(`${label} failed validation (${field})`);
      }
      if (!scriptsAllowed && (parsed.data.ruleType === 'script' || parsed.data.actionType === 'script')) {
        throw new BackupImportValidationError(
          `${label} uses a custom script, which is disabled unless FILTARR_ENABLE_CUSTOM_SCRIPTS=true`,
        );
      }
    });

    const jobs = this.selectAll(sourceDb, 'jobs');
    jobs.forEach((row, index) => {
      const label = `jobs row ${index + 1}`;
      const parsed = createJobSchema.safeParse({
        name: row['name'],
        description: toOptional(row['description']),
        schedule: row['schedule'],
        type: row['type'],
        payload: toOptional(row['payload']),
        enabled: toOptionalBoolean(row['enabled']),
      });
      if (!parsed.success) {
        const field = parsed.error.issues[0]?.path.join('.') || 'row';
        throw new BackupImportValidationError(`${label} failed validation (${field})`);
      }
      if (!scriptsAllowed && parsed.data.type === 'custom_script') {
        throw new BackupImportValidationError(
          `${label} is a custom script job, which is disabled unless FILTARR_ENABLE_CUSTOM_SCRIPTS=true`,
        );
      }
    });

    for (const row of this.selectAll(sourceDb, 'settings')) {
      const key = typeof row['key'] === 'string' ? row['key'] : '';
      if (!RESTORABLE_SETTING_KEYS.has(key) || BLANKED_SETTING_KEYS.has(key)) continue;

      let valid = validateSettingValue(key, row['value']);
      if (valid && key === 'backup_directory') {
        valid = this.isDirectoryAllowed(row['value'] as string);
      }
      if (!valid) {
        throw new BackupImportValidationError(`settings key "${key}" has an invalid value`);
      }
    }
  }

  private restoreFromDatabase(sourceDb: Database.Database): void {
    // Tables whose rows are never exported (users, sessions, api_keys, events)
    // must never be cleared on restore, otherwise importing a settings backup
    // would remove every admin account and API key. Settings are merged key by
    // key below rather than cleared.
    const restoredTables = EXPORT_TABLES.filter(
      (table) => !TABLES_WITHOUT_EXPORTED_ROWS.has(table) && table !== 'settings',
    );
    const deleteOrder = [...restoredTables].reverse();
    const insertOrder = [...restoredTables];

    const importedSettings = new Map<string, string>();
    for (const row of this.selectAll(sourceDb, 'settings')) {
      const key = typeof row['key'] === 'string' ? row['key'] : '';
      if (RESTORABLE_SETTING_KEYS.has(key) && typeof row['value'] === 'string') {
        importedSettings.set(key, row['value']);
      }
    }

    const restore = this.db.transaction(() => {
      for (const table of deleteOrder) {
        this.db.prepare(`DELETE FROM ${this.quoteIdentifier(table)}`).run();
      }

      for (const table of insertOrder) {
        const columns = this.getTableColumns(sourceDb, table);
        if (columns.length === 0) continue;

        for (const row of this.selectAll(sourceDb, table)) {
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

      for (const key of RESTORABLE_SETTING_KEYS) {
        const imported = importedSettings.get(key);

        if (BLANKED_SETTING_KEYS.has(key)) {
          // Secrets: a usable imported value is re-encrypted with this server's
          // key; otherwise whatever is configured now is kept.
          const secret = this.toStoredImportedSecret(imported);
          if (secret !== null) {
            this.upsertSetting(key, secret);
          } else if (imported !== undefined && this.getSettingValue(key) === undefined) {
            this.upsertSetting(key, '');
          }
          continue;
        }

        if (imported === undefined) {
          this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
        } else {
          this.upsertSetting(key, key === 'backup_directory' ? this.normalizeDirectory(imported) : imported);
        }
      }
    });

    // PRAGMA foreign_keys is a no-op inside a transaction, so toggle it around
    // the transaction and restore the connection's previous setting afterwards.
    const foreignKeysWereOn = Boolean(this.db.pragma('foreign_keys', { simple: true }));
    this.db.pragma('foreign_keys = OFF');
    try {
      restore();
    } finally {
      if (foreignKeysWereOn) this.db.pragma('foreign_keys = ON');
    }
  }

  /**
   * Turn an imported secret setting into its stored form, or null when the
   * backup carries no usable value. Plaintext is encrypted; an `enc:` value is
   * kept only if it decrypts with this server's key.
   */
  private toStoredImportedSecret(value: string | undefined): string | null {
    const trimmed = value?.trim();
    if (!trimmed) return null;

    if (isEncryptedStoredSecret(trimmed)) {
      try {
        return decryptStoredSecret(trimmed, this.dataDir) ? trimmed : null;
      } catch {
        return null;
      }
    }

    return encryptStoredSecret(trimmed, this.dataDir);
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
      const key = typeof row['key'] === 'string' ? row['key'] : '';
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

  private normalizeImportedRow(
    table: (typeof EXPORT_TABLES)[number],
    row: Record<string, unknown>,
  ): Record<string, unknown> {
    if (table === 'arr_instances') {
      // Imported API keys are never trusted: always store a blank placeholder.
      return { ...row, api_key_encrypted: encrypt('', this.dataDir) };
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

  private selectAll(db: Database.Database, table: (typeof EXPORT_TABLES)[number]): Array<Record<string, unknown>> {
    if (this.getTableColumns(db, table).length === 0) return [];
    return db.prepare(`SELECT * FROM ${this.quoteIdentifier(table)}`).all() as Array<Record<string, unknown>>;
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
    if (!this.isDirectoryAllowed(directory) || !fs.existsSync(directory)) return [];

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
    // Only prune files this service wrote; never touch other *.sql files that
    // happen to live in the configured directory.
    const backups = this.listBackups(directory).filter((backup) => BACKUP_FILE_PATTERN.test(backup.fileName));
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
    return valid.toSorted((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
  }

  /** Only generic messages are ever surfaced; filesystem details stay in the logs. */
  private getLastError(): string | null {
    const value = this.getSettingValue('backup_last_error')?.trim();
    if (!value) return null;
    return KNOWN_BACKUP_ERRORS.has(value) ? value : BACKUP_WRITE_ERROR_MESSAGE;
  }

  private getDirectorySetting(): string {
    return this.normalizeDirectory(this.getSettingValue('backup_directory') ?? this.defaultDirectory);
  }

  private normalizeDirectory(directory: string): string {
    const trimmed = directory.trim();
    return path.resolve(this.dataDir, trimmed.length > 0 ? trimmed : this.defaultDirectory);
  }

  private isDirectoryAllowed(directory: string): boolean {
    try {
      this.resolveBackupDirectory(directory, false);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolve a backup directory and require it (after resolving symlinks) to be
   * inside the data directory. With `create`, the directory is created when
   * missing and re-checked afterwards. Throws BackupDirectoryError otherwise.
   */
  private resolveBackupDirectory(directory: string, create: boolean): string {
    const requested = path.resolve(this.normalizeDirectory(directory));
    fs.mkdirSync(this.dataDir, { recursive: true });

    // Lexical containment first: the resolved path must sit under the resolved
    // data directory. This is the check static analysis recognises; the
    // realpath-based checks below additionally defeat symlink escapes.
    const lexicalRoot = path.resolve(this.dataDir);
    if (!requested.startsWith(lexicalRoot)) {
      throw new BackupDirectoryError();
    }
    // startsWith alone would accept a sibling such as `<dataDir>-other`; require a boundary.
    const boundary = requested.charAt(lexicalRoot.length);
    if (boundary !== '' && boundary !== path.sep) {
      throw new BackupDirectoryError();
    }
    const candidate = requested;

    const dataRoot = fs.realpathSync(this.dataDir);
    if (!isPathInside(dataRoot, realpathOfNearestAncestor(candidate))) {
      throw new BackupDirectoryError();
    }

    if (create) {
      fs.mkdirSync(candidate, { recursive: true });
      if (!isPathInside(dataRoot, fs.realpathSync(candidate))) {
        throw new BackupDirectoryError();
      }
    }

    return candidate;
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
    if (typeof value === 'object') return `'${JSON.stringify(value).replaceAll("'", "''")}'`;
    const stringified = String(value as string | boolean | symbol);
    return `'${stringified.replaceAll("'", "''")}'`;
  }

  private quoteIdentifier(value: string): string {
    return `"${value.replaceAll('"', '""')}"`;
  }

  private formatFileTimestamp(isoString: string): string {
    return isoString.replaceAll(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace('T', '-').replace('Z', '');
  }
}