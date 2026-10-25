import type Database from 'better-sqlite3';
import type { AuthMode } from '../../config/auth.js';

/**
 * Read the configured auth mode from the settings table.
 *
 * Returns 'none' only when no auth mode has been stored. Database errors are
 * deliberately NOT swallowed: callers must fail closed (e.g. requireAuth answers 503)
 * rather than treating an unreadable setting as "auth disabled".
 */
export function getAuthMode(db: Database.Database): AuthMode {
  const result = db
    .prepare<[], { value: string }>(`SELECT value FROM settings WHERE key = 'auth_mode'`)
    .get();
  return (result?.value as AuthMode) || 'none';
}

/**
 * Whether the initial setup wizard still needs to run.
 *
 * Setup is considered complete when the `setup_complete` flag is set OR any user or API key
 * exists, so a wiped/edited `setup_complete` setting cannot reopen the wizard on a live
 * instance. Throws on database errors (callers fail closed).
 */
export function needsSetup(db: Database.Database): boolean {
  const row = db
    .prepare<[], { setupComplete: string | null; hasUsers: number; hasApiKeys: number }>(
      `SELECT
         (SELECT value FROM settings WHERE key = 'setup_complete') AS setupComplete,
         EXISTS (SELECT 1 FROM users) AS hasUsers,
         EXISTS (SELECT 1 FROM api_keys) AS hasApiKeys`,
    )
    .get();
  if (!row) return true;
  return row.setupComplete !== 'true' && !row.hasUsers && !row.hasApiKeys;
}
