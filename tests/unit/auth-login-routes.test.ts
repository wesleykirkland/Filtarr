import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/app.js';
import { openFormsTestDatabase, type FormsTestDatabase } from '../support/formsApp.js';

describe('login endpoint hardening', () => {
  let testDb: FormsTestDatabase;
  let db: FormsTestDatabase['db'];

  beforeEach(() => {
    testDb = openFormsTestDatabase('filtarr-login-');
    db = testDb.db;
  });

  afterEach(() => {
    delete process.env['FILTARR_TRUST_PROXY'];
    testDb.cleanup();
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
