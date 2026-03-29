/**
 * AES-256-GCM encryption for sensitive data (API keys).
 *
 * Encryption key is derived from FILTARR_SECRET env var using PBKDF2.
 * If FILTARR_SECRET is not set, a random key is generated and persisted
 * to the data directory on first run.
 */

import { randomBytes, createCipheriv, createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const TAG_LENGTH = 16; // 128 bits auth tag
const KEY_LENGTH = 32; // 256 bits
const PBKDF2_ITERATIONS = 100_000;
const STORED_SECRET_PREFIX = 'enc:';

let _derivedKey: Buffer | null = null;

/**
 * Get or derive the encryption key.
 * Priority: FILTARR_SECRET env var → persisted key file → auto-generate.
 */
export function getEncryptionKey(dataDir = './data'): Buffer {
  if (_derivedKey) return _derivedKey;

  const secret = process.env['FILTARR_SECRET'];

  if (secret) {
    // Derive key from secret using PBKDF2 with a fixed salt
    // (fixed salt is OK here because the secret itself should be high-entropy)
    const salt = Buffer.from('filtarr-key-derivation-salt-v1');
    _derivedKey = pbkdf2Sync(secret, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
    return _derivedKey;
  }

  // Fall back to persisted key file
  const keyPath = join(dataDir, '.encryption-key');

  try {
    _derivedKey = Buffer.from(readFileSync(keyPath, 'utf-8').trim(), 'hex');
    if (_derivedKey.length !== KEY_LENGTH) {
      throw new Error(`Invalid encryption key length in ${keyPath}`);
    }
    return _derivedKey;
  } catch (err: unknown) {
    // File does not exist — auto-generate and persist
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  _derivedKey = randomBytes(KEY_LENGTH);
  mkdirSync(dirname(keyPath), { recursive: true });
  writeFileSync(keyPath, _derivedKey.toString('hex'), { mode: 0o600 });
  return _derivedKey;
}

/**
 * Encrypt a plaintext string.
 * Returns a hex-encoded string: iv + authTag + ciphertext
 */
export function encrypt(plaintext: string, dataDir?: string): string {
  const key = getEncryptionKey(dataDir);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);

  const authTag = cipher.getAuthTag();

  // Format: iv (12 bytes) + authTag (16 bytes) + ciphertext
  return Buffer.concat([iv, authTag, encrypted]).toString('hex');
}

/**
 * Decrypt a hex-encoded encrypted string.
 */
export function decrypt(encryptedHex: string, dataDir?: string): string {
  const key = getEncryptionKey(dataDir);
  const data = Buffer.from(encryptedHex, 'hex');

  if (data.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('Invalid encrypted data: too short');
  }

  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return decrypted.toString('utf-8');
}

/**
 * Mark whether a persisted secret value is already encrypted-at-rest.
 */
export function isEncryptedStoredSecret(value: string | null | undefined): boolean {
  return Boolean(value?.startsWith(STORED_SECRET_PREFIX));
}

/**
 * Encrypt a secret before storing it in the database.
 */
export function encryptStoredSecret(plaintext: string | null | undefined, dataDir?: string): string | null {
  if (!plaintext) return null;
  return `${STORED_SECRET_PREFIX}${encrypt(plaintext, dataDir)}`;
}

/**
 * Decrypt a stored secret, while remaining backward-compatible with legacy
 * plaintext rows that have not been migrated yet.
 */
export function decryptStoredSecret(value: string | null | undefined, dataDir?: string): string | null {
  if (!value) return null;
  if (!isEncryptedStoredSecret(value)) return value;
  return decrypt(value.slice(STORED_SECRET_PREFIX.length), dataDir);
}

/**
 * Mask an API key for display: "••••••••abcd"
 * Shows only the last 4 characters.
 */
export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 4) return '••••••••';
  return '••••••••' + apiKey.slice(-4);
}

/**
 * Reset the cached encryption key (for testing).
 */
export function resetEncryptionKey(): void {
  _derivedKey = null;
}
