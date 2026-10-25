import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { resetConfigCache } from '../../src/config/index.js';
import { closeDatabase, openDatabase } from '../../src/db/index.js';
import { createApp } from '../../src/server/app.js';

describe('login endpoint hardening', () => {
  let db: ReturnType<typeof openDatabase>;
  let tempDir: string;

  beforeEach(() => {
    resetConfigCache();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filtarr-login-'));
    process.env['FILTARR_DATA_DIR'] = tempDir;
    process.env['NODE_ENV'] = 'test';
    db = openDatabase(tempDir);
    db.prepare(
      `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('auth_mode', 'forms', datetime('now'))`,
    ).run();
  });

  afterEach(() => {
    closeDatabase(db);
    resetConfigCache();
    delete process.env['FILTARR_DATA_DIR'];
    delete process.env['FILTARR_TRUST_PROXY'];
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('rejects GET /auth/login with 405 so credentials cannot be sent in the query string', async () => {
    const app = createApp(db);
    const res = await request(app).get('/api/v1/auth/login?username=admin&password=secret');

    expect(res.status).toBe(405);
    expect(res.headers['allow']).toBe('POST');
  });

  it('rate limits only login, once, leaving session polling unthrottled', async () => {
    const app = createApp(db);

    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/api/v1/auth/login').send({ username: 'x', password: 'y' });
      expect(res.status).toBe(401);
    }
    const limited = await request(app).post('/api/v1/auth/login').send({ username: 'x', password: 'y' });
    expect(limited.status).toBe(429);

    for (let i = 0; i < 10; i++) {
      const res = await request(app).get('/api/v1/auth/session');
      expect(res.status).toBe(200);
    }
  });

  it('ignores X-Forwarded-For for rate-limit keys unless trust proxy is configured', async () => {
    const app = createApp(db);

    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', `203.0.113.${i}`)
        .send({ username: 'x', password: 'y' });
    }
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '203.0.113.99')
      .send({ username: 'x', password: 'y' });
    expect(res.status).toBe(429);
  });

  it('applies FILTARR_TRUST_PROXY to the express app', () => {
    process.env['FILTARR_TRUST_PROXY'] = '1';
    const app = createApp(db);
    expect(app.get('trust proxy')).toBe(1);

    delete process.env['FILTARR_TRUST_PROXY'];
    expect(createApp(db).get('trust proxy')).toBe(false);
  });
});
