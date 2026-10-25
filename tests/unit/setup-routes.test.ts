import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, openDatabase } from '../../src/db/index.js';
import { createApp } from '../../src/server/app.js';
import { errorHandler } from '../../src/server/middleware/errorHandler.js';
import { createSetupRoutes } from '../../src/server/routes/setup.js';
import { needsSetup } from '../../src/server/lib/authMode.js';
import { getSetupTokenForTests } from '../../src/server/lib/setupToken.js';

describe('setup routes', () => {
  let db: ReturnType<typeof openDatabase>;
  let tempDir: string;

  function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/', createSetupRoutes(db));
    app.use(errorHandler);
    return app;
  }

  function count(table: string): number {
    return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filtarr-setup-'));
    db = openDatabase(tempDir);
  });

  afterEach(() => {
    closeDatabase(db);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('rolls back the admin user and setup flag when a later write fails, so setup can be retried', async () => {
    const app = makeApp();
    db.exec(`
      CREATE TRIGGER fail_api_key_insert BEFORE INSERT ON api_keys
      BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;
    `);

    const failed = await request(app)
      .post('/complete')
      .send({
        authMode: 'forms',
        username: 'admin',
        password: 'password123',
        setupToken: getSetupTokenForTests(),
      });
    expect(failed.status).toBe(500);
    expect(count('users')).toBe(0);
    expect((await request(app).get('/status')).body).toEqual({ needsSetup: true });

    db.exec('DROP TRIGGER fail_api_key_insert');

    const retried = await request(app)
      .post('/complete')
      .send({
        authMode: 'forms',
        username: 'admin',
        password: 'password123',
        setupToken: getSetupTokenForTests(),
      });
    expect(retried.status).toBe(201);
    expect(typeof retried.body.apiKey).toBe('string');
    expect(count('users')).toBe(1);
    expect(count('api_keys')).toBe(1);
    expect((await request(app).get('/status')).body).toEqual({ needsSetup: false });

    const again = await request(app).post('/complete').send({ authMode: 'none', setupToken: getSetupTokenForTests() });
    expect(again.status).toBe(403);
  });

  it('rejects setup with a missing or wrong token without revealing why', async () => {
    const app = makeApp();
    const body = { authMode: 'forms', username: 'admin', password: 'password123' };

    const missing = await request(app).post('/complete').send(body);
    expect(missing.status).toBe(403);
    expect(missing.body).toEqual({ error: 'Forbidden' });

    const wrong = await request(app)
      .post('/complete')
      .send({ ...body, setupToken: 'a'.repeat(64) });
    expect(wrong.status).toBe(403);
    expect(wrong.body).toEqual({ error: 'Forbidden' });

    expect(count('users')).toBe(0);
    expect((await request(app).get('/status')).body).toEqual({ needsSetup: true });

    const right = await request(app)
      .post('/complete')
      .send({ ...body, setupToken: getSetupTokenForTests() });
    expect(right.status).toBe(201);
    expect(count('users')).toBe(1);
  });

  it('rotates the generated token once setup completes', async () => {
    const app = makeApp();
    const token = getSetupTokenForTests();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    await request(app).post('/complete').send({ authMode: 'none', setupToken: token }).expect(201);
    expect(getSetupTokenForTests()).not.toBe(token);
  });

  it('honors FILTARR_SETUP_TOKEN when set', async () => {
    process.env['FILTARR_SETUP_TOKEN'] = 'preset-token-from-env';
    try {
      const app = makeApp();
      expect(getSetupTokenForTests()).toBe('preset-token-from-env');
      await request(app)
        .post('/complete')
        .send({ authMode: 'none', setupToken: 'preset-token-from-env' })
        .expect(201);
    } finally {
      delete process.env['FILTARR_SETUP_TOKEN'];
    }
  });

  it('treats setup as complete when a user or API key exists even if the flag is missing', () => {
    expect(needsSetup(db)).toBe(true);
    db.prepare(`INSERT INTO users (username, password_hash) VALUES ('admin', 'hash')`).run();
    expect(needsSetup(db)).toBe(false);
    db.prepare('DELETE FROM users').run();
    db.prepare(
      `INSERT INTO api_keys (name, key_hash, key_prefix, key_last4, scopes) VALUES ('k', 'h', 'p', 'l', '[]')`,
    ).run();
    expect(needsSetup(db)).toBe(false);
  });

  it('refuses to reopen setup when setup_complete is wiped but a user exists', async () => {
    const app = makeApp();
    db.prepare(`INSERT INTO users (username, password_hash) VALUES ('admin', 'hash')`).run();
    db.prepare(`DELETE FROM settings WHERE key = 'setup_complete'`).run();

    expect((await request(app).get('/status')).body).toEqual({ needsSetup: false });
    const res = await request(app)
      .post('/complete')
      .send({ authMode: 'none', setupToken: getSetupTokenForTests() });
    expect(res.status).toBe(403);
  });
});

describe('app-level setup and host guards', () => {
  let db: ReturnType<typeof openDatabase>;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filtarr-setup-app-'));
    db = openDatabase(tempDir);
  });

  afterEach(() => {
    closeDatabase(db);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('rejects protected routes with 401 before setup but keeps health and setup reachable', async () => {
    const app = createApp(db);

    expect((await request(app).get('/api/v1/filters')).status).toBe(401);
    expect((await request(app).post('/api/v1/instances').send({})).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/api-keys')).status).toBe(401);
    expect((await request(app).get('/api/v1/health')).status).toBe(200);
    expect((await request(app).get('/api/v1/setup/status')).body).toEqual({ needsSetup: true });

    await request(app)
      .post('/api/v1/setup/complete')
      .send({ authMode: 'none', setupToken: getSetupTokenForTests() })
      .expect(201);
    expect((await request(app).get('/api/v1/filters')).status).toBe(200);
  });

  it('does not rate limit GET /setup/status', async () => {
    const app = createApp(db);
    for (let i = 0; i < 8; i += 1) {
      expect((await request(app).get('/api/v1/setup/status')).status).toBe(200);
    }
  });
});
