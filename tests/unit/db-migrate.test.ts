import Database from 'better-sqlite3';
import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';

describe('runMigrations', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records only the baseline migration, once, across repeated runs', () => {
    const db = new Database(':memory:');

    runMigrations(db);
    runMigrations(db);

    const names = db.prepare<[], { name: string }>('SELECT name FROM _migrations').all();
    expect(names).toEqual([{ name: '001_initial.sql' }]);
    db.close();
  });

  it('repairs legacy schemas idempotently', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    // Simulate an older database: drop columns repairLegacySchema adds, plus a legacy flag.
    db.exec(`
      ALTER TABLE filters DROP COLUMN notify_slack_token;
      ALTER TABLE filters DROP COLUMN target_path;
      ALTER TABLE filters ADD COLUMN notify_slack_enabled INTEGER;
      INSERT INTO filters (name, trigger_source, rule_type, rule_payload, action_type, notify_slack_enabled)
      VALUES ('legacy', 'watcher', 'extension', '{}', 'blocklist', 1);
    `);

    runMigrations(db);
    const columnsAfterFirst = db.prepare('PRAGMA table_info(filters)').all();
    runMigrations(db);
    const columnsAfterSecond = db.prepare('PRAGMA table_info(filters)').all();

    expect(columnsAfterSecond).toEqual(columnsAfterFirst);
    const names = (columnsAfterSecond as { name: string }[]).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['notify_slack_token', 'target_path']));
    expect(db.prepare('SELECT notify_slack, override_notifications FROM filters').get()).toEqual({
      notify_slack: 1,
      override_notifications: 1,
    });
    db.close();
  });

  it('logs and exits cleanly when no migrations directory exists', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    const db = {
      exec: vi.fn(),
      prepare: vi.fn(() => ({ all: () => [] })),
    };

    runMigrations(db as unknown as Database.Database);

    expect(logSpy).toHaveBeenCalledWith('No migrations directory found, skipping migrations.');
  });
});