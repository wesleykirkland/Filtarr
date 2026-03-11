import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apiKeyMiddleware,
  createInitialApiKey,
  generateApiKey,
  getKeyIdentifiers,
  hashApiKey,
} from '../../src/server/middleware/apiKey.js';

function createApiKeyDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      key_last4 TEXT NOT NULL,
      user_id INTEGER,
      scopes TEXT,
      revoked_at TEXT,
      expires_at TEXT,
      last_used_at TEXT
    );
  `);
  return db;
}

describe('api key middleware helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates and hashes keys with stable identifiers', async () => {
    const key = generateApiKey();
    const hash = await hashApiKey(key, 4);

    expect(key).toMatch(/^flt_[a-f0-9]{64}$/);
    expect(getKeyIdentifiers(key)).toEqual({ prefix: key.slice(0, 12), last4: key.slice(-4) });
    expect(await bcrypt.compare(key, hash)).toBe(true);
  });

  it('creates the initial key once and authenticates valid requests', async () => {
    const db = createApiKeyDb();
    const key = await createInitialApiKey(db, 4);
    const skipped = await createInitialApiKey(db, 4);

    expect(key).toMatch(/^flt_/);
    expect(skipped).toBe('');

    const middleware = apiKeyMiddleware(db);
    const req = { headers: { 'x-api-key': key } } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await middleware(req, res, next);

    expect(req.apiKey).toMatchObject({ apiKeyName: 'Initial API Key', scopes: ['*'] });
    expect(next).toHaveBeenCalledTimes(1);
    expect(
      db.prepare<[], { last_used_at: string | null }>('SELECT last_used_at FROM api_keys WHERE id = 1').get()
        ?.last_used_at,
    ).not.toBeNull();

    db.close();
  });

  it('passes through missing headers and rejects invalid keys', async () => {
    const db = createApiKeyDb();
    const middleware = apiKeyMiddleware(db);

    const passReq = { headers: {} } as any;
    const passRes = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const passNext = vi.fn();
    await middleware(passReq, passRes, passNext);
    expect(passNext).toHaveBeenCalledTimes(1);

    const badReq = { headers: { 'x-api-key': 'bad-key' } } as any;
    const badRes = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    await middleware(badReq, badRes, vi.fn());
    expect(badRes.status).toHaveBeenCalledWith(401);

    const unknownReq = { headers: { 'x-api-key': generateApiKey() } } as any;
    const unknownRes = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    await middleware(unknownReq, unknownRes, vi.fn());
    expect(unknownRes.status).toHaveBeenCalledWith(401);

    db.close();
  });
});