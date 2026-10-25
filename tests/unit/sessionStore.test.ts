import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import request from 'supertest';
import type { SessionData } from 'express-session';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetConfigCache } from '../../src/config/index.js';
import { closeDatabase, openDatabase } from '../../src/db/index.js';
import { runMigrations } from '../../src/db/migrate.js';
import { createApp } from '../../src/server/app.js';
import { SqliteSessionStore, destroyAllSessions } from '../../src/server/lib/sessionStore.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  db.prepare("INSERT INTO users (id, username, password_hash) VALUES (1, 'admin', 'x')").run();
  return db;
}

function sessionData(overrides: Record<string, unknown> = {}): SessionData {
  return {
    cookie: { originalMaxAge: 60_000, expires: new Date(Date.now() + 60_000) },
    passport: { user: 1 },
    ...overrides,
  } as unknown as SessionData;
}

function promisify<T>(fn: (cb: (err: unknown, value?: T) => void) => void): Promise<T | undefined> {
  return new Promise((resolve, reject) => fn((err, value) => (err ? reject(err) : resolve(value))));
}

describe('SqliteSessionStore', () => {
  let db: Database.Database;
  let store: SqliteSessionStore;

  beforeEach(() => {
    db = makeDb();
    store = new SqliteSessionStore(db, { pruneIntervalMs: 0 });
  });

  afterEach(() => {
    store.close();
    db.close();
  });

  it('round-trips session data through set and get', async () => {
    const sess = sessionData({ extra: { nested: true } });
    await promisify<undefined>((cb) => store.set('sid-1', sess, cb));

    const loaded = await promisify<SessionData | null>((cb) => store.get('sid-1', cb));
    expect(loaded).toMatchObject({ passport: { user: 1 }, extra: { nested: true } });

    const row = db.prepare('SELECT user_id FROM sessions WHERE id = ?').get('sid-1') as { user_id: number };
    expect(row.user_id).toBe(1);
  });

  it('stores pre-login sessions with a null user', async () => {
    await promisify<undefined>((cb) => store.set('anon', sessionData({ passport: undefined }), cb));
    const row = db.prepare('SELECT user_id FROM sessions WHERE id = ?').get('anon') as { user_id: null };
    expect(row.user_id).toBeNull();
  });

  it('returns null for unknown and expired sessions, and prunes expired rows', async () => {
    expect(await promisify((cb) => store.get('missing', cb))).toBeNull();

    const expired = sessionData({
      cookie: { originalMaxAge: 1, expires: new Date(Date.now() - 1000) },
    });
    await promisify<undefined>((cb) => store.set('old', expired, cb));
    expect(await promisify((cb) => store.get('old', cb))).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });

    await promisify<undefined>((cb) => store.set('old2', expired, cb));
    expect(store.pruneExpired()).toBe(1);
  });

  it('derives expiry from maxAge when no expires date is set and touch extends it', async () => {
    await promisify<undefined>((cb) =>
      store.set('sid', sessionData({ cookie: { originalMaxAge: 5000, maxAge: 5000 } }), cb),
    );
    const before = db.prepare('SELECT expires_at FROM sessions WHERE id = ?').get('sid') as {
      expires_at: string;
    };
    expect(new Date(before.expires_at).getTime()).toBeGreaterThan(Date.now());

    const later = new Date(Date.now() + 3_600_000);
    await new Promise<void>((resolve) =>
      store.touch('sid', sessionData({ cookie: { originalMaxAge: 1, expires: later } }), resolve),
    );
    const after = db.prepare('SELECT expires_at FROM sessions WHERE id = ?').get('sid') as {
      expires_at: string;
    };
    expect(after.expires_at).toBe(later.toISOString());
  });

  it('destroys one session, lists, counts and clears all', async () => {
    await promisify<undefined>((cb) => store.set('a', sessionData(), cb));
    await promisify<undefined>((cb) => store.set('b', sessionData(), cb));
    expect(await promisify<number>((cb) => store.length(cb))).toBe(2);

    await promisify<undefined>((cb) => store.destroy('a', cb));
    expect(await promisify((cb) => store.get('a', cb))).toBeNull();
    expect(Object.keys((await promisify((cb) => store.all(cb))) ?? {})).toEqual(['b']);

    await promisify<undefined>((cb) => store.clear(cb));
    expect(await promisify<number>((cb) => store.length(cb))).toBe(0);
  });

  it('destroyAllSessions removes every row', async () => {
    await promisify<undefined>((cb) => store.set('a', sessionData(), cb));
    destroyAllSessions(db);
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
  });

  it('cascades session rows when the user is deleted', async () => {
    await promisify<undefined>((cb) => store.set('a', sessionData(), cb));
    db.prepare('DELETE FROM users WHERE id = 1').run();
    expect(await promisify((cb) => store.get('a', cb))).toBeNull();
  });
});

describe('runMigrations sessions repair', () => {
  it('recreates a legacy sessions table whose user_id is NOT NULL', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, data TEXT NOT NULL DEFAULT '{}',
        expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));`);
    runMigrations(db);
    const cols = db.prepare('PRAGMA table_info(sessions)').all() as { name: string; notnull: number }[];
    expect(cols.find((c) => c.name === 'user_id')?.notnull).toBe(0);
    db.close();
  });
});

describe('session persistence across restarts', () => {
  let tempDir: string;

  beforeEach(() => {
    resetConfigCache();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filtarr-session-'));
    process.env['FILTARR_DATA_DIR'] = tempDir;
    process.env['NODE_ENV'] = 'test';
  });

  afterEach(() => {
    resetConfigCache();
    delete process.env['FILTARR_DATA_DIR'];
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('keeps a forms login valid for a new app instance over the same database', async () => {
    const db = openDatabase(tempDir);
    db.prepare(
      `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('auth_mode', 'forms', datetime('now'))`,
    ).run();
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(
      'admin',
      bcrypt.hashSync('correct horse battery', 4),
    );

    const login = await request(createApp(db))
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: 'correct horse battery' });
    expect(login.status).toBe(200);
    const cookie = login.headers['set-cookie'];
    expect(cookie).toBeDefined();

    // Simulate a restart: a fresh app (and store) over a new connection to the same file.
    // The first connection stays open because passport keeps its (global) deserializers.
    const reopened = openDatabase(tempDir);
    try {
      const res = await request(createApp(reopened)).get('/api/v1/auth/session').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ authenticated: true });

      const anonymous = await request(createApp(reopened)).get('/api/v1/auth/session');
      expect(anonymous.body).toMatchObject({ authenticated: false });
    } finally {
      closeDatabase(reopened);
      closeDatabase(db);
    }
  });
});
