import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
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
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetEncryptionKey();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('derives a stable key from FILTARR_SECRET', () => {
    process.env['FILTARR_SECRET'] = 'super-secret-value';

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
});