import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../config/index.js';
import { runMigrations } from './migrate.js';
import { migrateEncryptedSecrets } from './secretMigration.js';

let _db: Database.Database | null = null;

export function openDatabase(dataDir: string): Database.Database {
  // Ensure data directory exists
  fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, 'filtarr.db');
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

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
