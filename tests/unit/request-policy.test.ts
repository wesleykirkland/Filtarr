import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  noStoreApiResponses,
  rejectCrossSiteRequests,
  requireJsonBody,
  sensitiveActionLimiter,
  SENSITIVE_ACTION_PATHS,
} from '../../src/server/middleware/requestPolicy.js';
import { resetConfigCache } from '../../src/config/index.js';
import { closeDatabase, openDatabase } from '../../src/db/index.js';
import { createApp } from '../../src/server/app.js';

function makeApp(allowedOrigins: string | string[] = []) {
  const app = express();
  app.use('/api', noStoreApiResponses());
  app.use('/api', rejectCrossSiteRequests(allowedOrigins));
  app.use('/api', requireJsonBody());
  app.post(SENSITIVE_ACTION_PATHS, sensitiveActionLimiter());
  app.use(express.json());
  app.all('/api/v1/{*path}', (req, res) => {
    res.json({ ok: true, body: req.body ?? null });
  });
  app.post('/outside', (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe('requireJsonBody', () => {
  it('rejects form-encoded and text bodies on mutating API requests with 415', async () => {
    const app = makeApp();

    const form = await request(app)
      .post('/api/v1/auth/login')
      .type('form')
      .send('username=admin&password=secret');
    expect(form.status).toBe(415);
    expect(form.body.error).toMatch(/application\/json/);

    const text = await request(app).put('/api/v1/settings/app').set('Content-Type', 'text/plain').send('{"a":1}');
    expect(text.status).toBe(415);

    const missingType = await request(app)
      .delete('/api/v1/instances/1')
      .set('Content-Type', '')
      .send(Buffer.from('x=1'));
    expect(missingType.status).toBe(415);
  });

  it('accepts JSON (with charset or +json) and bodyless requests', async () => {
    const app = makeApp();

    const json = await request(app).post('/api/v1/filters').send({ name: 'x' });
    expect(json.status).toBe(200);
    expect(json.body.body).toEqual({ name: 'x' });

    const charset = await request(app)
      .post('/api/v1/filters')
      .set('Content-Type', 'application/json; charset=utf-8')
      .send('{"name":"y"}');
    expect(charset.status).toBe(200);

    const vendor = await request(app)
      .post('/api/v1/filters')
      .set('Content-Type', 'application/vnd.filtarr+json')
      .send('{"name":"z"}');
    expect(vendor.status).toBe(200);

    expect((await request(app).post('/api/v1/auth/logout')).status).toBe(200);
    expect((await request(app).delete('/api/v1/instances/1')).status).toBe(200);
  });

  it('does not affect non-API routes or GET requests', async () => {
    const app = makeApp();
    expect((await request(app).post('/outside').type('form').send('a=1')).status).toBe(200);
    expect((await request(app).get('/api/v1/instances')).status).toBe(200);
  });
});

describe('rejectCrossSiteRequests', () => {
  it('rejects cross-site cookie/basic requests by Origin, Referer, or Sec-Fetch-Site', async () => {
    const app = makeApp();

    const byOrigin = await request(app)
      .post('/api/v1/filters')
      .set('Host', 'filtarr.local:3000')
      .set('Origin', 'https://evil.example')
      .set('Cookie', 'filtarr.sid=abc')
      .send({ name: 'x' });
    expect(byOrigin.status).toBe(403);
    expect(byOrigin.body).toEqual({ error: 'Cross-site request rejected' });

    const byReferer = await request(app)
      .delete('/api/v1/instances/1')
      .set('Host', 'filtarr.local:3000')
      .set('Referer', 'https://evil.example/page');
    expect(byReferer.status).toBe(403);

    const nullOrigin = await request(app)
      .post('/api/v1/filters')
      .set('Host', 'filtarr.local:3000')
      .set('Origin', 'null')
      .send({});
    expect(nullOrigin.status).toBe(403);

    const crossSiteNoOrigin = await request(app)
      .post('/api/v1/filters')
      .set('Sec-Fetch-Site', 'cross-site')
      .send({});
    expect(crossSiteNoOrigin.status).toBe(403);
  });

  it('allows same-origin browser requests and non-browser clients', async () => {
    const app = makeApp();

    const sameOrigin = await request(app)
      .post('/api/v1/filters')
      .set('Host', 'filtarr.local:3000')
      .set('Origin', 'http://filtarr.local:3000')
      .set('Sec-Fetch-Site', 'same-origin')
      .send({});
    expect(sameOrigin.status).toBe(200);

    const fetchSiteOnly = await request(app).post('/api/v1/filters').set('Sec-Fetch-Site', 'same-origin').send({});
    expect(fetchSiteOnly.status).toBe(200);

    const originMatchesHost = await request(app)
      .post('/api/v1/filters')
      .set('Host', 'filtarr.local:3000')
      .set('Origin', 'http://filtarr.local:3000')
      .send({});
    expect(originMatchesHost.status).toBe(200);

    const noHeaders = await request(app).post('/api/v1/filters').send({});
    expect(noHeaders.status).toBe(200);

    const safeMethod = await request(app).get('/api/v1/filters').set('Origin', 'https://evil.example');
    expect(safeMethod.status).toBe(200);
  });

  it('exempts x-api-key requests and honors configured CORS origins', async () => {
    const app = makeApp(['https://app.example.com']);

    const apiKey = await request(app)
      .post('/api/v1/filters')
      .set('Host', 'filtarr.local:3000')
      .set('Origin', 'https://evil.example')
      .set('Sec-Fetch-Site', 'cross-site')
      .set('X-Api-Key', 'flt_test')
      .send({});
    expect(apiKey.status).toBe(200);

    const corsAllowed = await request(app)
      .post('/api/v1/filters')
      .set('Host', 'filtarr.local:3000')
      .set('Origin', 'https://app.example.com')
      .set('Sec-Fetch-Site', 'cross-site')
      .send({});
    expect(corsAllowed.status).toBe(200);
  });
});

describe('noStoreApiResponses', () => {
  it('sets Cache-Control: no-store and Pragma: no-cache on API responses only', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/v1/instances');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['pragma']).toBe('no-cache');

    const outside = await request(app).post('/outside');
    expect(outside.headers['cache-control']).toBeUndefined();
  });
});

describe('sensitiveActionLimiter', () => {
  it('returns JSON 429 after 10 sensitive actions per minute', async () => {
    const app = makeApp();

    for (let i = 0; i < 10; i++) {
      const res = await request(app).post(`/api/v1/instances/${i}/test`);
      expect(res.status).toBe(200);
    }

    const limited = await request(app).post('/api/v1/settings/backup/create');
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: 'Too many requests for this action. Please try again later.' });

    // Non-sensitive endpoints are unaffected.
    expect((await request(app).post('/api/v1/filters').send({})).status).toBe(200);
    expect((await request(app).get('/api/v1/instances/1/test')).status).toBe(200);
  });
});

describe('request policy wiring in createApp', () => {
  let db: ReturnType<typeof openDatabase>;
  let tempDir: string;

  beforeEach(() => {
    resetConfigCache();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filtarr-request-policy-'));
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
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('rejects urlencoded and cross-site bodies and marks API responses no-store', async () => {
    const app = createApp(db);

    const form = await request(app).post('/api/v1/auth/login').type('form').send('username=a&password=b');
    expect(form.status).toBe(415);

    const crossSite = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ username: 'a', password: 'b' });
    expect(crossSite.status).toBe(403);

    const health = await request(app).get('/api/v1/health');
    expect(health.headers['cache-control']).toBe('no-store');
    expect(health.headers['pragma']).toBe('no-cache');
  });
});
