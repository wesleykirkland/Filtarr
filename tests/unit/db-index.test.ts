import fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  databaseFactory: vi.fn(),
  DatabaseCtor: vi.fn(function (this: unknown, ...args: unknown[]) {
    return state.databaseFactory(...args);
  }),
  getConfig: vi.fn(() => ({ dataDir: '/tmp/filtarr-data' })),
  runMigrations: vi.fn(),
  migrateEncryptedSecrets: vi.fn(),
}));

vi.mock('better-sqlite3', () => ({ default: state.DatabaseCtor }));
vi.mock('../../src/config/index.js', () => ({ getConfig: state.getConfig }));
vi.mock('../../src/db/migrate.js', () => ({ runMigrations: state.runMigrations }));
vi.mock('../../src/db/secretMigration.js', () => ({ migrateEncryptedSecrets: state.migrateEncryptedSecrets }));

import { closeDatabase, getDatabase, openDatabase } from '../../src/db/index.js';

function createDb() {
  return { pragma: vi.fn(), close: vi.fn() };
}

describe('db index helpers', () => {
  beforeEach(() => {
    closeDatabase();
    state.databaseFactory.mockReset();
    state.DatabaseCtor.mockClear();
    state.getConfig.mockClear();
    state.runMigrations.mockClear();
    state.migrateEncryptedSecrets.mockClear();
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined as any);
  });

  it('opens the database, ensures the directory exists, and runs initialization hooks', () => {
    const db = createDb();
    state.databaseFactory.mockReturnValueOnce(db);

    const result = openDatabase('/data/filtarr');

    expect(fs.mkdirSync).toHaveBeenCalledWith('/data/filtarr', { recursive: true });
    expect(state.DatabaseCtor).toHaveBeenCalledWith('/data/filtarr/filtarr.db');
    expect(db.pragma).toHaveBeenCalledWith('journal_mode = WAL');
    expect(db.pragma).toHaveBeenCalledWith('foreign_keys = ON');
    expect(state.runMigrations).toHaveBeenCalledWith(db);
    expect(state.migrateEncryptedSecrets).toHaveBeenCalledWith(db);
    expect(result).toBe(db);
  });

  it('caches the singleton database until it is closed', () => {
    const first = createDb();
    const second = createDb();
    state.databaseFactory.mockReturnValueOnce(first).mockReturnValueOnce(second);

    expect(getDatabase()).toBe(first);
    expect(getDatabase()).toBe(first);
    expect(state.getConfig).toHaveBeenCalledTimes(1);
    expect(state.DatabaseCtor).toHaveBeenCalledTimes(1);

    closeDatabase();
    expect(first.close).toHaveBeenCalledTimes(1);

    expect(getDatabase()).toBe(second);
    expect(state.DatabaseCtor).toHaveBeenCalledTimes(2);
  });

  it('closes non-singleton databases without disturbing the cached instance', () => {
    const cached = createDb();
    const other = createDb();
    state.databaseFactory.mockReturnValueOnce(cached);

    getDatabase();
    closeDatabase(other as any);
    expect(other.close).toHaveBeenCalledTimes(1);
    expect(cached.close).not.toHaveBeenCalled();

    closeDatabase();
    expect(cached.close).toHaveBeenCalledTimes(1);
  });
});