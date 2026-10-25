import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcrypt';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { resetConfigCache } from '../../src/config/index.js';
import { closeDatabase, openDatabase } from '../../src/db/index.js';
import { createApp } from '../../src/server/app.js';
import { generateApiKey, getKeyIdentifiers, hashApiKey, hasScope } from '../../src/server/middleware/apiKey.js';

type Db = ReturnType<typeof openDatabase>;

async function insertKey(db: Db, scopes: string[], name = 'test'): Promise<{ id: number; key: string }> {
  const key = generateApiKey();
  const { prefix, last4 } = getKeyIdentifiers(key);
  const result = db
    .prepare(`INSERT INTO api_keys (name, key_hash, key_prefix, key_last4, scopes) VALUES (?, ?, ?, ?, ?)`)
    .run(name, await hashApiKey(key, 4), prefix, last4, JSON.stringify(scopes));
  return { id: Number(result.lastInsertRowid), key };
}

function setAuthMode(db: Db, mode: string): void {
  db.prepare(
    `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('auth_mode', ?, datetime('now'))`,
  ).run(mode);
}

async function insertUser(db: Db, username = 'admin', password = 'correct-horse'): Promise<number> {
  const result = db
    .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(username, await bcrypt.hash(password, 4));
  return Number(result.lastInsertRowid);
}

describe('hasScope', () => {
  it('treats scopes hierarchically with * granting everything', () => {
    expect(hasScope(['*'], 'admin')).toBe(true);
    expect(hasScope(['admin'], 'write')).toBe(true);
    expect(hasScope(['write'], 'read')).toBe(true);
    expect(hasScope(['write'], 'admin')).toBe(false);
    expect(hasScope(['read'], 'write')).toBe(false);
    expect(hasScope([], 'read')).toBe(false);
    expect(hasScope(['bogus'], 'read')).toBe(false);
  });
});

describe('API key scopes, ownership, and password changes', () => {
  let db: Db;
  let tempDir: string;

  beforeEach(() => {
    resetConfigCache();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filtarr-scopes-'));
    process.env['FILTARR_DATA_DIR'] = tempDir;
    process.env['NODE_ENV'] = 'test';
    db = openDatabase(tempDir);
    setAuthMode(db, 'forms');
  });

  afterEach(() => {
    closeDatabase(db);
    resetConfigCache();
    delete process.env['FILTARR_DATA_DIR'];
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('scope enforcement', () => {
    it('lets a read key GET but not POST', async () => {
      const { key } = await insertKey(db, ['read']);
      const app = createApp(db);

      expect((await request(app).get('/api/v1/filters').set('X-Api-Key', key)).status).toBe(200);
      const post = await request(app)
        .post('/api/v1/filters')
        .set('X-Api-Key', key)
        .send({ name: 'x', triggerSource: 'manual', ruleType: 'extension', rulePayload: 'exe', actionType: 'blocklist' });
      expect(post.status).toBe(403);
      expect(post.body.error).toContain("'write'");
      expect((await request(app).put('/api/v1/settings/notifications').set('X-Api-Key', key).send({})).status).toBe(403);
      expect((await request(app).delete('/api/v1/instances/1').set('X-Api-Key', key)).status).toBe(403);
    });

    it('lets a write key mutate resources but not manage API keys or change auth mode', async () => {
      const { key } = await insertKey(db, ['write']);
      const app = createApp(db);

      const post = await request(app)
        .post('/api/v1/filters')
        .set('X-Api-Key', key)
        .send({ name: 'x', triggerSource: 'manual', ruleType: 'extension', rulePayload: 'exe', actionType: 'blocklist' });
      expect(post.status).toBe(201);

      expect((await request(app).get('/api/v1/auth/api-keys').set('X-Api-Key', key)).status).toBe(403);
      expect((await request(app).post('/api/v1/auth/api-keys').set('X-Api-Key', key).send({ name: 'n' })).status).toBe(403);
      const authMode = await request(app).put('/api/v1/settings/auth-mode').set('X-Api-Key', key).send({ authMode: 'none' });
      expect(authMode.status).toBe(403);
      const upperCase = await request(app).put('/api/v1/settings/AUTH-MODE').set('X-Api-Key', key).send({ authMode: 'none' });
      expect(upperCase.status).toBe(403);
      const importRes = await request(app).post('/api/v1/settings/backup/import').set('X-Api-Key', key).send({ sql: 'x' });
      expect(importRes.status).toBe(403);
      expect(db.prepare(`SELECT value FROM settings WHERE key = 'auth_mode'`).get()).toEqual({ value: 'forms' });
    });

    it('lets an admin key create scoped keys and change auth mode', async () => {
      const { key } = await insertKey(db, ['admin']);
      const app = createApp(db);

      const created = await request(app).post('/api/v1/auth/api-keys').set('X-Api-Key', key).send({ name: 'ci', scopes: ['read'] });
      expect(created.status).toBe(201);
      expect(created.body.scopes).toEqual(['read']);

      const defaulted = await request(app).post('/api/v1/auth/api-keys').set('X-Api-Key', key).send({ name: 'd' });
      expect(defaulted.body.scopes).toEqual(['write']);

      const invalid = await request(app).post('/api/v1/auth/api-keys').set('X-Api-Key', key).send({ scopes: ['*'] });
      expect(invalid.status).toBe(400);

      const list = await request(app).get('/api/v1/auth/api-keys').set('X-Api-Key', key);
      expect(list.status).toBe(200);
      expect(list.body.find((k: { name: string }) => k.name === 'ci').scopes).toEqual(['read']);

      const readKey = created.body.key as string;
      expect((await request(app).get('/api/v1/jobs').set('X-Api-Key', readKey)).status).toBe(200);
      expect((await request(app).post('/api/v1/jobs').set('X-Api-Key', readKey).send({})).status).toBe(403);

      const authMode = await request(app).put('/api/v1/settings/auth-mode').set('X-Api-Key', key).send({ authMode: 'none' });
      expect(authMode.status).toBe(200);
    });

    it('keeps full access for session-authenticated users', async () => {
      await insertUser(db);
      const agent = request.agent(createApp(db));
      expect((await agent.post('/api/v1/auth/login').send({ username: 'admin', password: 'correct-horse' })).status).toBe(200);
      const created = await agent.post('/api/v1/auth/api-keys').send({ name: 'ui' });
      expect(created.status).toBe(201);
      expect(created.body.scopes).toEqual(['write']);
    });
  });

  describe('rotate/revoke ownership', () => {
    it('lets a non-admin key rotate and revoke only itself', async () => {
      const own = await insertKey(db, ['write'], 'own');
      const other = await insertKey(db, ['write'], 'other');
      const app = createApp(db);

      const rotateOther = await request(app).post('/api/v1/auth/api-keys/rotate').set('X-Api-Key', own.key).send({ keyId: other.id });
      expect(rotateOther.status).toBe(403);
      const deleteOther = await request(app).delete(`/api/v1/auth/api-keys/${other.id}`).set('X-Api-Key', own.key);
      expect(deleteOther.status).toBe(403);
      expect(db.prepare('SELECT revoked_at FROM api_keys WHERE id = ?').get(other.id)).toEqual({ revoked_at: null });

      const rotateSelf = await request(app).post('/api/v1/auth/api-keys/rotate').set('X-Api-Key', own.key).send({});
      expect(rotateSelf.status).toBe(201);
      expect(rotateSelf.body.revokedKeyId).toBe(own.id);
      const newKey = rotateSelf.body.apiKey as string;
      const rotatedScopes = db.prepare('SELECT scopes FROM api_keys WHERE id = ?').get(rotateSelf.body.id) as { scopes: string };
      expect(JSON.parse(rotatedScopes.scopes)).toEqual(['write']);

      const deleteSelf = await request(app).delete(`/api/v1/auth/api-keys/${rotateSelf.body.id}`).set('X-Api-Key', newKey);
      expect(deleteSelf.status).toBe(200);
    });

    it('lets an admin key rotate and revoke any key', async () => {
      const admin = await insertKey(db, ['admin']);
      const other = await insertKey(db, ['read']);
      const app = createApp(db);

      const rotated = await request(app).post('/api/v1/auth/api-keys/rotate').set('X-Api-Key', admin.key).send({ keyId: other.id });
      expect(rotated.status).toBe(201);
      const revoked = await request(app).delete(`/api/v1/auth/api-keys/${rotated.body.id}`).set('X-Api-Key', admin.key);
      expect(revoked.status).toBe(200);
    });
  });

  describe('PUT /auth/password', () => {
    it('changes the password, resets lockout counters, and invalidates other sessions', async () => {
      const userId = await insertUser(db);
      db.prepare('UPDATE users SET failed_attempts = 3 WHERE id = ?').run(userId);
      const app = createApp(db);
      const agent = request.agent(app);
      const other = request.agent(app);
      for (const a of [agent, other]) {
        expect((await a.post('/api/v1/auth/login').send({ username: 'admin', password: 'correct-horse' })).status).toBe(200);
      }
      db.prepare('UPDATE users SET failed_attempts = 2 WHERE id = ?').run(userId);

      const res = await agent.put('/api/v1/auth/password').send({ currentPassword: 'correct-horse', newPassword: 'battery-staple' });
      expect(res.status).toBe(200);
      expect(res.headers['set-cookie']?.[0]).toMatch(/^filtarr\.sid=/);

      const row = db.prepare('SELECT password_hash, failed_attempts FROM users WHERE id = ?').get(userId) as {
        password_hash: string;
        failed_attempts: number;
      };
      expect(await bcrypt.compare('battery-staple', row.password_hash)).toBe(true);
      expect(row.failed_attempts).toBe(0);

      // The caller keeps a fresh session; every other session is gone.
      expect((await agent.get('/api/v1/auth/session')).body.authenticated).toBe(true);
      expect((await other.get('/api/v1/auth/session')).body.authenticated).toBe(false);
    });

    it('rejects a wrong current password, short new passwords, and non-session callers', async () => {
      await insertUser(db);
      const { key } = await insertKey(db, ['*']);
      const app = createApp(db);
      const agent = request.agent(app);
      await agent.post('/api/v1/auth/login').send({ username: 'admin', password: 'correct-horse' });

      const wrong = await agent.put('/api/v1/auth/password').send({ currentPassword: 'nope', newPassword: 'battery-staple' });
      expect(wrong.status).toBe(403);
      expect(wrong.body.error).toBe('Current password is incorrect');

      const short = await agent.put('/api/v1/auth/password').send({ currentPassword: 'correct-horse', newPassword: 'short' });
      expect(short.status).toBe(400);

      const viaKey = await request(app).put('/api/v1/auth/password').set('X-Api-Key', key).send({ currentPassword: 'correct-horse', newPassword: 'battery-staple' });
      expect(viaKey.status).toBe(401);

      const row = db.prepare('SELECT password_hash FROM users').get() as { password_hash: string };
      expect(await bcrypt.compare('correct-horse', row.password_hash)).toBe(true);
    });
  });

  describe('Basic auth handling', () => {
    it('ignores Basic credentials in forms mode', async () => {
      await insertUser(db);
      const app = createApp(db);
      const header = `Basic ${Buffer.from('admin:correct-horse').toString('base64')}`;
      const res = await request(app).get('/api/v1/filters').set('Authorization', header);
      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toBeUndefined();
    });

    it('rate limits failed Basic attempts per IP without throttling successful requests', async () => {
      setAuthMode(db, 'basic');
      await insertUser(db, 'admin', 'correct-horse');
      await insertUser(db, 'other', 'other-password');
      const app = createApp(db);
      const good = `Basic ${Buffer.from('admin:correct-horse').toString('base64')}`;

      for (let i = 0; i < 8; i++) {
        expect((await request(app).get('/api/v1/filters').set('Authorization', good)).status).toBe(200);
      }

      // Spread across usernames so account lockout is not what stops them.
      for (let i = 0; i < 5; i++) {
        const bad = `Basic ${Buffer.from(`user${i}:wrong`).toString('base64')}`;
        expect((await request(app).get('/api/v1/filters').set('Authorization', bad)).status).toBe(401);
      }
      const limited = await request(app)
        .get('/api/v1/filters')
        .set('Authorization', `Basic ${Buffer.from('other:other-password').toString('base64')}`);
      expect(limited.status).toBe(429);
    });

    it('returns the same login error for unknown users, wrong passwords, and locked accounts', async () => {
      const userId = await insertUser(db);
      const app = createApp(db);
      const unknown = await request(app).post('/api/v1/auth/login').send({ username: 'ghost', password: 'x' });
      const wrong = await request(app).post('/api/v1/auth/login').send({ username: 'admin', password: 'x' });
      db.prepare(`UPDATE users SET locked_until = '2999-01-01T00:00:00.000Z' WHERE id = ?`).run(userId);
      const locked = await request(app).post('/api/v1/auth/login').send({ username: 'admin', password: 'correct-horse' });

      for (const res of [unknown, wrong, locked]) {
        expect(res.status).toBe(401);
        expect(res.body).toEqual({ error: 'Invalid credentials' });
      }
    });
  });
});
