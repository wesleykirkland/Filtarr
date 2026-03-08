import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../config/index.js';
import { runMigrations } from './migrate.js';

let _db: Database.Database | null = null;

function resolveDatabaseDataDir(dataDir: string): string {
  const vitestPoolId = process.env['VITEST_POOL_ID'] ?? process.env['VITEST_WORKER_ID'];

  if (vitestPoolId) {
    return path.join(dataDir, `vitest-worker-${vitestPoolId}`);
  }

  return dataDir;
}

export function getDatabase(): Database.Database {
  if (_db) return _db;

  const config = getConfig();
  const dataDir = resolveDatabaseDataDir(config.dataDir);

  // Ensure data directory exists
  fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, 'filtarr.db');
  _db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  // Run migrations
  runMigrations(_db);

  return _db;
}

export function closeDatabase(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
