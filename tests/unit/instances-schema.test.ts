import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  encrypt: vi.fn((value: string) => `enc:${value}`),
  decrypt: vi.fn((value: string) => `dec:${value}`),
  maskApiKey: vi.fn((value: string) => `masked:${value}`),
}));

vi.mock('../../src/services/encryption.js', () => ({
  encrypt: state.encrypt,
  decrypt: state.decrypt,
  maskApiKey: state.maskApiKey,
}));

import {
  createInstance,
  deleteInstance,
  getAllInstances,
  getEnabledInstanceConfigs,
  getInstanceById,
  getInstanceConfigById,
  updateInstance,
} from '../../src/db/schemas/instances.js';

describe('instances schema helpers', () => {
  let db: Database.Database;

  beforeEach(() => {
    state.encrypt.mockClear();
    state.decrypt.mockClear();
    state.maskApiKey.mockClear();
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE arr_instances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        url TEXT NOT NULL,
        api_key_encrypted TEXT NOT NULL,
        timeout INTEGER NOT NULL,
        enabled INTEGER NOT NULL,
        skip_ssl_verify INTEGER NOT NULL,
        remote_path TEXT,
        local_path TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  });

  afterEach(() => {
    db.close();
  });

  it('lists masked instances, returns decrypted configs, and handles missing ids', () => {
    db.prepare(
      `INSERT INTO arr_instances
        (id, name, type, url, api_key_encrypted, timeout, enabled, skip_ssl_verify, remote_path, local_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    ).run(2, 'Zulu', 'radarr', 'https://zulu.example', 'enc:zulu', 45000, 0, 1, null, null);
    db.prepare(
      `INSERT INTO arr_instances
        (id, name, type, url, api_key_encrypted, timeout, enabled, skip_ssl_verify, remote_path, local_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    ).run(1, 'Alpha', 'sonarr', 'https://alpha.example', 'enc:alpha', 30000, 1, 0, '/remote', '/local');

    expect(getAllInstances(db)).toEqual([
      expect.objectContaining({ id: 1, name: 'Alpha', apiKey: 'masked:dec:enc:alpha', enabled: true, skipSslVerify: false }),
      expect.objectContaining({ id: 2, name: 'Zulu', apiKey: 'masked:dec:enc:zulu', enabled: false, skipSslVerify: true }),
    ]);
    expect(getInstanceById(db, 1)).toEqual(expect.objectContaining({ id: 1, apiKey: 'masked:dec:enc:alpha' }));
    expect(getInstanceById(db, 99)).toBeNull();
    expect(getInstanceConfigById(db, 1)).toEqual(
      expect.objectContaining({ id: 1, apiKey: 'dec:enc:alpha', remotePath: '/remote', localPath: '/local' }),
    );
    expect(getInstanceConfigById(db, 99)).toBeNull();
    expect(getEnabledInstanceConfigs(db)).toEqual([
      expect.objectContaining({ id: 1, name: 'Alpha', apiKey: 'dec:enc:alpha', enabled: true }),
    ]);
  });

  it('creates instances with normalized urls, default values, and explicit overrides', () => {
    const created = createInstance(db, {
      name: 'Main Sonarr',
      type: 'sonarr',
      url: 'https://sonarr.example.com///',
      apiKey: 'secret-key',
    });
    const customized = createInstance(db, {
      name: 'Disabled Radarr',
      type: 'radarr',
      url: 'https://radarr.example.com////',
      apiKey: 'other-key',
      timeout: 5000,
      enabled: false,
      skipSslVerify: true,
      remotePath: '/remote',
      localPath: '/local',
    });

    expect(state.encrypt).toHaveBeenNthCalledWith(1, 'secret-key');
    expect(created).toEqual(
      expect.objectContaining({
        name: 'Main Sonarr',
        url: 'https://sonarr.example.com',
        apiKey: 'masked:dec:enc:secret-key',
        timeout: 30000,
        enabled: true,
        skipSslVerify: false,
        remotePath: null,
        localPath: null,
      }),
    );
    expect(customized).toEqual(
      expect.objectContaining({
        name: 'Disabled Radarr',
        url: 'https://radarr.example.com',
        apiKey: 'masked:dec:enc:other-key',
        timeout: 5000,
        enabled: false,
        skipSslVerify: true,
        remotePath: '/remote',
        localPath: '/local',
      }),
    );

    expect(
      db.prepare<[], { url: string; api_key_encrypted: string; enabled: number; skip_ssl_verify: number }>(
        'SELECT url, api_key_encrypted, enabled, skip_ssl_verify FROM arr_instances WHERE id = ?',
      ).get(created.id),
    ).toEqual({ url: 'https://sonarr.example.com', api_key_encrypted: 'enc:secret-key', enabled: 1, skip_ssl_verify: 0 });
  });

  it('updates instances across all supported fields, preserves no-op updates, and returns null when missing', () => {
    db.prepare(
      `INSERT INTO arr_instances
        (id, name, type, url, api_key_encrypted, timeout, enabled, skip_ssl_verify, remote_path, local_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    ).run(1, 'Original', 'sonarr', 'https://original.example', 'enc:old-key', 30000, 1, 0, '/old-remote', '/old-local');

    expect(updateInstance(db, 99, { name: 'Missing' })).toBeNull();
    expect(updateInstance(db, 1, {})).toEqual(expect.objectContaining({ id: 1, name: 'Original', apiKey: 'masked:dec:enc:old-key' }));

    const updated = updateInstance(db, 1, {
      name: 'Updated',
      type: 'radarr',
      url: 'https://updated.example////',
      apiKey: 'new-key',
      timeout: 15000,
      enabled: false,
      skipSslVerify: true,
      remotePath: null,
      localPath: null,
    });

    expect(state.encrypt).toHaveBeenCalledWith('new-key');
    expect(updated).toEqual(
      expect.objectContaining({
        id: 1,
        name: 'Updated',
        type: 'radarr',
        url: 'https://updated.example',
        apiKey: 'masked:dec:enc:new-key',
        timeout: 15000,
        enabled: false,
        skipSslVerify: true,
        remotePath: null,
        localPath: null,
      }),
    );
    expect(
      db.prepare<[], { name: string; type: string; url: string; api_key_encrypted: string; enabled: number; skip_ssl_verify: number }>(
        'SELECT name, type, url, api_key_encrypted, enabled, skip_ssl_verify FROM arr_instances WHERE id = 1',
      ).get(),
    ).toEqual({
      name: 'Updated',
      type: 'radarr',
      url: 'https://updated.example',
      api_key_encrypted: 'enc:new-key',
      enabled: 0,
      skip_ssl_verify: 1,
    });

    expect(updateInstance(db, 1, { enabled: true, skipSslVerify: false })).toEqual(
      expect.objectContaining({ id: 1, enabled: true, skipSslVerify: false }),
    );
  });

  it('deletes instances and reports when the row is already gone', () => {
    db.prepare(
      `INSERT INTO arr_instances
        (name, type, url, api_key_encrypted, timeout, enabled, skip_ssl_verify, remote_path, local_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('Delete Me', 'sonarr', 'https://delete.example', 'enc:delete', 30000, 1, 0, null, null);

    expect(deleteInstance(db, 1)).toBe(true);
    expect(deleteInstance(db, 1)).toBe(false);
  });
});