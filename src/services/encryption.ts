/**
 * AES-256-GCM encryption for sensitive data (API keys, notification secrets).
 *
 * Encryption key is derived from FILTARR_SECRET env var using PBKDF2.
 * If FILTARR_SECRET is not set, a random key is generated and persisted
 * to the configured data directory (FILTARR_DATA_DIR) on first run.
 *
 * Ciphertext formats (hex-encoded iv + authTag + ciphertext):
 * - legacy: `<hex>` with no additional authenticated data. Still accepted on decrypt.
 * - v2:     `v2:<hex>` with `filtarr:v2:<context>` bound as GCM AAD, so a value
 *           encrypted for one column/purpose cannot be replayed into another.
 */

import { randomBytes, createCipheriv, createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type BetterSqlite3 from 'better-sqlite3';
import { getConfig } from '../config/index.js';
import { logger } from '../server/lib/logger.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const TAG_LENGTH = 16; // 128 bits auth tag
const KEY_LENGTH = 32; // 256 bits
const PBKDF2_ITERATIONS = 100_000;
const STORED_SECRET_PREFIX = 'enc:';
const V2_PREFIX = 'v2:';

/** Minimum length for FILTARR_SECRET when it is set. */
export const MIN_SECRET_LENGTH = 32;

/** Default AAD context for callers that do not bind ciphertext to a column. */
export const DEFAULT_ENCRYPTION_CONTEXT = 'generic';

let _derivedKey: Buffer | null = null;

/**
 * Throw a clear error when FILTARR_SECRET is set but too short to be a safe
 * key-derivation input. An empty value is treated as unset.
 */
export function assertEncryptionSecretStrength(secret = process.env['FILTARR_SECRET']): void {
  if (!secret) return;
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `FILTARR_SECRET must be at least ${MIN_SECRET_LENGTH} characters (got ${secret.length}). ` +
        'Generate one with `openssl rand -base64 32`, or unset it to use the generated key file.',
    );
  }
}

function readKeyFile(keyPath: string): Buffer {
  const key = Buffer.from(readFileSync(keyPath, 'utf-8').trim(), 'hex');
  if (key.length !== KEY_LENGTH) {
    throw new Error(`Invalid encryption key length in ${keyPath}`);
  }
  return key;
}

/**
 * Get or derive the encryption key.
 * Priority: FILTARR_SECRET env var → persisted key file → auto-generate.
 *
 * When `dataDir` is omitted, the key file is resolved under the configured
 * data directory (`getConfig().dataDir`, i.e. FILTARR_DATA_DIR) rather than a
 * path relative to the process working directory.
 */
export function getEncryptionKey(dataDir?: string): Buffer {
  if (_derivedKey) return _derivedKey;

  const secret = process.env['FILTARR_SECRET'];

  // An empty FILTARR_SECRET (e.g. docker-compose `${FILTARR_SECRET:-}`) is
  // intentionally treated the same as unset and falls through to the key file.
  if (secret) {
    assertEncryptionSecretStrength(secret);
    // The fixed salt is kept for backward compatibility with existing ciphertext;
    // the secret is required to be >= 32 characters so it carries its own entropy.
    const salt = Buffer.from('filtarr-key-derivation-salt-v1');
    _derivedKey = pbkdf2Sync(secret, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
    return _derivedKey;
  }

  // Fall back to persisted key file
  const keyPath = join(dataDir ?? getConfig().dataDir, '.encryption-key');

  try {
    _derivedKey = readKeyFile(keyPath);
    return _derivedKey;
  } catch (err: unknown) {
    // File does not exist — auto-generate and persist
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const generated = randomBytes(KEY_LENGTH);
  mkdirSync(dirname(keyPath), { recursive: true });
  try {
    // `wx` fails if another process created the file between our read and write,
    // so two concurrent first boots cannot end up with different keys.
    writeFileSync(keyPath, generated.toString('hex'), { mode: 0o600, flag: 'wx' });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    _derivedKey = readKeyFile(keyPath);
    return _derivedKey;
  }
  _derivedKey = generated;

  // Runs at most once per process because the key is cached above.
  if (getConfig().nodeEnv === 'production') {
    logger.warn(
      { keyPath },
      'FILTARR_SECRET is not set; generated a new encryption key file. Back up this file or set FILTARR_SECRET, otherwise stored API keys cannot be decrypted if it is lost.',
    );
  }
  return _derivedKey;
}

function buildAad(context: string): Buffer {
  return Buffer.from(`filtarr:v2:${context}`, 'utf-8');
}

/**
 * Encrypt a plaintext string.
 * Returns `v2:` + hex(iv + authTag + ciphertext), with `context` bound as GCM AAD.
 */
export function encrypt(
  plaintext: string,
  dataDir?: string,
  context: string = DEFAULT_ENCRYPTION_CONTEXT,
): string {
  const key = getEncryptionKey(dataDir);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(buildAad(context));

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return V2_PREFIX + Buffer.concat([iv, authTag, encrypted]).toString('hex');
}

/**
 * Decrypt a value produced by `encrypt`. Accepts both the `v2:` format (which
 * must be decrypted with the same `context` it was encrypted with) and the
 * legacy unversioned format (no AAD; `context` is ignored).
 */
export function decrypt(
  encryptedValue: string,
  dataDir?: string,
  context: string = DEFAULT_ENCRYPTION_CONTEXT,
): string {
  const key = getEncryptionKey(dataDir);
  const isV2 = encryptedValue.startsWith(V2_PREFIX);
  const data = Buffer.from(isV2 ? encryptedValue.slice(V2_PREFIX.length) : encryptedValue, 'hex');

  if (data.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('Invalid encrypted data: too short');
  }

  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  if (isV2) decipher.setAAD(buildAad(context));
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
 * Encrypt a secret before storing it in the database. `context` (e.g. the column
 * name) is bound as AAD; the same context must be passed to `decryptStoredSecret`.
 */
export function encryptStoredSecret(
  plaintext: string | null | undefined,
  dataDir?: string,
  context?: string,
): string | null {
  if (!plaintext) return null;
  return `${STORED_SECRET_PREFIX}${encrypt(plaintext, dataDir, context)}`;
}

/**
 * Decrypt a stored secret, while remaining backward-compatible with legacy
 * plaintext rows that have not been migrated yet.
 */
export function decryptStoredSecret(
  value: string | null | undefined,
  dataDir?: string,
  context?: string,
): string | null {
  if (!value) return null;
  if (!isEncryptedStoredSecret(value)) return value;
  return decrypt(value.slice(STORED_SECRET_PREFIX.length), dataDir, context);
}

/**
 * Mask an API key for display: "••••••••abcd"
 * Shows only the last 4 characters.
 */
export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 4) return '••••••••';
  return '••••••••' + apiKey.slice(-4);
}

export const ENCRYPTION_CANARY_KEY = 'encryption_canary';
const ENCRYPTION_CANARY_CONTEXT = 'settings.encryption_canary';
const ENCRYPTION_CANARY_PLAINTEXT = 'filtarr-encryption-canary-v1';

/**
 * Detect a changed FILTARR_SECRET / replaced key file at startup.
 *
 * If the canary row exists it must decrypt to the known plaintext; otherwise
 * stored secrets are undecryptable and a clear error is logged (the row is left
 * untouched so restoring the original key fixes it). If no canary exists, one
 * is created with the current key. Returns whether the current key matches.
 */
export function verifyEncryptionCanary(db: BetterSqlite3.Database, dataDir?: string): boolean {
  const row = db
    .prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?')
    .get(ENCRYPTION_CANARY_KEY);

  if (!row?.value) {
    db.prepare(
      `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`,
    ).run(
      ENCRYPTION_CANARY_KEY,
      encryptStoredSecret(ENCRYPTION_CANARY_PLAINTEXT, dataDir, ENCRYPTION_CANARY_CONTEXT),
    );
    return true;
  }

  let ok: boolean;
  try {
    ok =
      decryptStoredSecret(row.value, dataDir, ENCRYPTION_CANARY_CONTEXT) ===
      ENCRYPTION_CANARY_PLAINTEXT;
  } catch {
    ok = false;
  }

  if (!ok) {
    logger.error(
      'Encryption canary check failed: the encryption key differs from the one used to store existing secrets. ' +
        'FILTARR_SECRET was changed or the .encryption-key file was replaced. Stored Arr API keys and ' +
        'notification secrets cannot be decrypted; restore the original secret/key file, or re-enter them.',
    );
  }
  return ok;
}

/**
 * Reset the cached encryption key (for testing).
 */
export function resetEncryptionKey(): void {
  _derivedKey = null;
}
