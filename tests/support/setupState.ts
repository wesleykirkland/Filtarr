import type Database from 'better-sqlite3';

/**
 * Mark initial setup as complete with auth mode "none".
 *
 * Protected routes reject every request until setup completes, so tests that exercise
 * protected routes through createApp() on a fresh database must call this first.
 */
export function markSetupComplete(db: Database.Database): void {
  const upsert = db.prepare(
    `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`,
  );
  upsert.run('setup_complete', 'true');
  upsert.run('auth_mode', 'none');
}
