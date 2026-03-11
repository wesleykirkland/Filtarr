import Database from 'better-sqlite3';
import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';

describe('runMigrations', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies migrations once and skips already-applied files', () => {
    const db = new Database(':memory:');

    runMigrations(db);
    const firstCount = db.prepare<[], { count: number }>('SELECT COUNT(*) as count FROM _migrations').get()
      ?.count;

    runMigrations(db);
    const secondCount = db.prepare<[], { count: number }>('SELECT COUNT(*) as count FROM _migrations').get()
      ?.count;

    expect(firstCount).toBeGreaterThan(0);
    expect(secondCount).toBe(firstCount);
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