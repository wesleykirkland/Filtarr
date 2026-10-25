import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../config/index.js';
import { runMigrations } from './migrate.js';
import { migrateEncryptedSecrets } from './secretMigration.js';

let _db: Database.Database | null = null;

/**
 * Restrict newly created files (database, WAL/SHM, backups, key file) to the
 * owner. process.umask() cannot be changed from worker threads, so failures
 * there are ignored and the explicit chmod below still applies.
 */
function restrictFileCreationMask(): void {
  try {
    process.umask(0o077);
  } catch {
    // Unsupported in worker threads.
  }
}

function restrictDatabaseFilePermissions(dbPath: string): void {
  for (const filePath of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      if (fs.existsSync(filePath)) fs.chmodSync(filePath, 0o600);
    } catch {
      // Best effort (e.g. read-only or non-POSIX filesystems).
    }
  }
}

export function openDatabase(dataDir: string): Database.Database {
  restrictFileCreationMask();

  // Ensure data directory exists
  fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, 'filtarr.db');
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  restrictDatabaseFilePermissions(dbPath);

  // Run migrations
  runMigrations(db);
  migrateEncryptedSecrets(db);

  return db;
}

export function getDatabase(): Database.Database {
  if (_db) return _db;

  const config = getConfig();
  _db = openDatabase(config.dataDir);

  return _db;
}

export function closeDatabase(db?: Database.Database | null): void {
  if (db && db !== _db) {
    db.close();
    return;
  }

  if (_db) {
    _db.close();
    _db = null;
  }
}
