import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { getAllDirectories } from '../../src/db/schemas/directories.js';

describe('database migrations', () => {
  it('preserves the directories table required by the watcher', () => {
    const db = new Database(':memory:');

    try {
      runMigrations(db);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>;

      expect(tables.map((table) => table.name)).toContain('directories');
      expect(() => getAllDirectories(db)).not.toThrow();
      expect(getAllDirectories(db)).toEqual([]);

      const exeFilter = db
        .prepare("SELECT name FROM filters WHERE name = 'Detect and Blocklist EXE Files'")
        .get() as { name: string } | undefined;

      expect(exeFilter).toBeUndefined();
    } finally {
      db.close();
    }
  });
});
