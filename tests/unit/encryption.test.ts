import { createCipheriv, randomBytes } from 'node:crypto';
import type * as NodeFs from 'node:fs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConfigCache } from '../../src/config/index.js';
import { logger } from '../../src/server/lib/logger.js';

const fsHooks = vi.hoisted(() => ({
  beforeWrite: null as null | ((file: unknown) => void),
  writeOptions: [] as unknown[],
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>();
  const writeFileSync = ((...args: Parameters<typeof actual.writeFileSync>) => {
    fsHooks.writeOptions.push(args[2]);
    fsHooks.beforeWrite?.(args[0]);
    return actual.writeFileSync(...args);
  }) as typeof actual.writeFileSync;
  return { ...actual, default: { ...actual, writeFileSync }, writeFileSync };
});

import {
  ENCRYPTION_CANARY_KEY,
  assertEncryptionSecretStrength,
  verifyEncryptionCanary,
  decrypt,
  decryptStoredSecret,
  encrypt,
  encryptStoredSecret,
  getEncryptionKey,
  isEncryptedStoredSecret,
  maskApiKey,
  resetEncryptionKey,
} from '../../src/services/encryption.js';

describe('encryption helpers', () => {
  const originalEnv = { ...process.env };
  let tempDir: string;

  beforeEach(() => {
    process.env = { ...originalEnv };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filtarr-encryption-'));
    resetEncryptionKey();
    fsHooks.beforeWrite = null;
    fsHooks.writeOptions = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    resetEncryptionKey();
    resetConfigCache();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('derives a stable key from FILTARR_SECRET', () => {
    process.env['FILTARR_SECRET'] = 'super-secret-value-that-is-long-enough-1234';

    const first = getEncryptionKey(tempDir);
    const second = getEncryptionKey(tempDir);

    expect(first.equals(second)).toBe(true);
    expect(first).toHaveLength(32);
    expect(fs.existsSync(path.join(tempDir, '.encryption-key'))).toBe(false);
  });

  it('loads a persisted key file and rejects invalid key lengths', () => {
    const keyPath = path.join(tempDir, '.encryption-key');
    fs.writeFileSync(keyPath, 'ab'.repeat(32));

    expect(getEncryptionKey(tempDir)).toHaveLength(32);

    resetEncryptionKey();
    fs.writeFileSync(keyPath, 'deadbeef');
    expect(() => getEncryptionKey(tempDir)).toThrow('Invalid encryption key length');
  });

  it('auto-generates, stores, encrypts, and decrypts values', () => {
    const key = getEncryptionKey(tempDir);
    expect(fs.readFileSync(path.join(tempDir, '.encryption-key'), 'utf-8')).toHaveLength(64);

    const encrypted = encrypt('hello world', tempDir);
    expect(encrypted).not.toContain('hello world');
    expect(decrypt(encrypted, tempDir)).toBe('hello world');
    expect(key).toHaveLength(32);
  });

  it('handles stored-secret helpers and masking', () => {
    const stored = encryptStoredSecret('top-secret', tempDir);

    expect(isEncryptedStoredSecret(stored)).toBe(true);
    expect(decryptStoredSecret(stored, tempDir)).toBe('top-secret');
    expect(decryptStoredSecret('legacy-plain-text', tempDir)).toBe('legacy-plain-text');
    expect(encryptStoredSecret(null, tempDir)).toBeNull();
    expect(decryptStoredSecret(undefined, tempDir)).toBeNull();
    expect(maskApiKey('abcd')).toBe('••••••••');
    expect(maskApiKey('flt_abcdefghijklmnopqrstuvwxyz')).toMatch(/••••••••wxyz$/);
  });

  it('rejects encrypted payloads that are too short to decode', () => {
    expect(() => decrypt('abcd', tempDir)).toThrow('Invalid encrypted data: too short');
  });

  it('persists the generated key under FILTARR_DATA_DIR when no dataDir is passed', () => {
    process.env['FILTARR_DATA_DIR'] = tempDir;
    delete process.env['FILTARR_SECRET'];
    resetConfigCache();
    resetEncryptionKey();

    const cwdKeyPath = path.resolve('./data', '.encryption-key');
    const cwdKeyBefore = fs.existsSync(cwdKeyPath) ? fs.readFileSync(cwdKeyPath, 'utf-8') : null;

    const encrypted = encrypt('stored-api-key');
    const keyPath = path.join(tempDir, '.encryption-key');

    expect(fs.existsSync(keyPath)).toBe(true);
    const keyHex = fs.readFileSync(keyPath, 'utf-8');
    expect(keyHex).toHaveLength(64);
    expect(getEncryptionKey().toString('hex')).toBe(keyHex);

    // The cwd-relative ./data key file must not have been created or rewritten.
    const cwdKeyAfter = fs.existsSync(cwdKeyPath) ? fs.readFileSync(cwdKeyPath, 'utf-8') : null;
    expect(cwdKeyAfter).toBe(cwdKeyBefore);
    expect(cwdKeyAfter).not.toBe(keyHex);

    // A fresh process (cleared cache) reloads the same key from the data dir.
    resetEncryptionKey();
    expect(decrypt(encrypted)).toBe('stored-api-key');
  });

  it('treats an empty FILTARR_SECRET as unset and falls back to the key file', () => {
    process.env['FILTARR_DATA_DIR'] = tempDir;
    process.env['FILTARR_SECRET'] = '';
    resetConfigCache();

    getEncryptionKey();

    expect(fs.existsSync(path.join(tempDir, '.encryption-key'))).toBe(true);
  });

  it('rejects a FILTARR_SECRET shorter than 32 characters', () => {
    process.env['FILTARR_SECRET'] = 'too-short-secret';

    expect(() => getEncryptionKey(tempDir)).toThrow('FILTARR_SECRET must be at least 32 characters');
    expect(() => assertEncryptionSecretStrength()).toThrow('got 16');
    expect(() => assertEncryptionSecretStrength('x'.repeat(32))).not.toThrow();
    expect(() => assertEncryptionSecretStrength('')).not.toThrow();
  });

  it('creates the key file exclusively and adopts a key written concurrently', () => {
    const keyPath = path.join(tempDir, '.encryption-key');
    const winnerKey = 'cd'.repeat(32);
    // Simulate another process creating the key file between our read and write.
    fsHooks.beforeWrite = (file) => {
      if (file !== keyPath) return;
      fsHooks.beforeWrite = null;
      fs.writeFileSync(keyPath, winnerKey);
    };

    const key = getEncryptionKey(tempDir);

    expect(fsHooks.writeOptions).toContainEqual(expect.objectContaining({ flag: 'wx', mode: 0o600 }));
    expect(key.toString('hex')).toBe(winnerKey);
    expect(fs.readFileSync(keyPath, 'utf-8')).toBe(winnerKey);
  });

  it('binds a context to v2 ciphertext', () => {
    const encrypted = encrypt('bound-secret', tempDir, 'filters.notify_slack_token');

    expect(encrypted.startsWith('v2:')).toBe(true);
    expect(decrypt(encrypted, tempDir, 'filters.notify_slack_token')).toBe('bound-secret');
    expect(() => decrypt(encrypted, tempDir, 'filters.notify_webhook_url')).toThrow();
    expect(() => decrypt(encrypted, tempDir)).toThrow();

    const stored = encryptStoredSecret('stored-bound', tempDir, 'api_key');
    expect(stored?.startsWith('enc:v2:')).toBe(true);
    expect(decryptStoredSecret(stored, tempDir, 'api_key')).toBe('stored-bound');
    expect(() => decryptStoredSecret(stored, tempDir, 'other')).toThrow();

    // The default context keeps existing call sites working.
    expect(decrypt(encrypt('generic-value', tempDir), tempDir)).toBe('generic-value');
  });

  it('still decrypts legacy unversioned ciphertext regardless of context', () => {
    const key = getEncryptionKey(tempDir);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([cipher.update('legacy-value', 'utf-8'), cipher.final()]);
    const legacyHex = Buffer.concat([iv, cipher.getAuthTag(), body]).toString('hex');

    expect(decrypt(legacyHex, tempDir)).toBe('legacy-value');
    expect(decrypt(legacyHex, tempDir, 'filters.notify_webhook_url')).toBe('legacy-value');
    expect(decryptStoredSecret(`enc:${legacyHex}`, tempDir, 'any')).toBe('legacy-value');
  });

  describe('encryption canary', () => {
    let db: Database.Database;

    beforeEach(() => {
      db = new Database(':memory:');
      db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT)');
    });

    afterEach(() => db.close());

    const readCanary = () =>
      db
        .prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?')
        .get(ENCRYPTION_CANARY_KEY)?.value;

    it('creates the canary on first boot and accepts it with the same key', () => {
      const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

      expect(verifyEncryptionCanary(db, tempDir)).toBe(true);
      const stored = readCanary();
      expect(stored).toMatch(/^enc:v2:/);

      resetEncryptionKey();
      expect(verifyEncryptionCanary(db, tempDir)).toBe(true);
      expect(readCanary()).toBe(stored);
      expect(error).not.toHaveBeenCalled();
    });

    it('logs a clear error and keeps the canary when the key changed', () => {
      const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
      process.env['FILTARR_SECRET'] = 'a'.repeat(40);
      verifyEncryptionCanary(db, tempDir);
      const stored = readCanary();

      resetEncryptionKey();
      process.env['FILTARR_SECRET'] = 'b'.repeat(40);

      expect(verifyEncryptionCanary(db, tempDir)).toBe(false);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Encryption canary check failed'));
      expect(readCanary()).toBe(stored);
    });
  });
});
