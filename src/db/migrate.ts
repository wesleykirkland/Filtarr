import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  const dirs = [
    migrationsDir,
    path.resolve(__dirname, '../../src/db/migrations'),
  ];

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

  const files = fs
    .readdirSync(resolvedDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied = new Set(
    (db.prepare('SELECT name FROM _migrations').all() as Array<{ name: string }>).map(
      (r) => r.name,
    ),
  );

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(resolvedDir, file), 'utf-8');
    console.log(`Applying migration: ${file}`);

    db.exec(sql);
    db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
  }
}

