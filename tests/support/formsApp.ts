import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetConfigCache } from '../../src/config/index.js';
import { closeDatabase, openDatabase } from '../../src/db/index.js';

export interface FormsTestDatabase {
  db: ReturnType<typeof openDatabase>;
  tempDir: string;
  /** Close the database, clear config caches and env, and remove the temp directory. */
  cleanup(): void;
}

/**
 * Open a fresh on-disk database in a temp FILTARR_DATA_DIR with auth_mode set to `forms`,
 * for tests that exercise the real app through `createApp`.
 */
export function openFormsTestDatabase(prefix = 'filtarr-test-'): FormsTestDatabase {
  resetConfigCache();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env['FILTARR_DATA_DIR'] = tempDir;
  process.env['NODE_ENV'] = 'test';
  const db = openDatabase(tempDir);
  db.prepare(
    `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('auth_mode', 'forms', datetime('now'))`,
  ).run();

  return {
    db,
    tempDir,
    cleanup() {
      closeDatabase(db);
      resetConfigCache();
      delete process.env['FILTARR_DATA_DIR'];
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}
