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
import { createApp } from '../../src/server/app.js';
import { openFormsTestDatabase, type FormsTestDatabase } from '../support/formsApp.js';

type HeaderMap = Record<string, string>;

/** POST /api/v1/filters with the given headers and an empty JSON body. */
function postFilters(app: express.Express, headers: HeaderMap = {}, body: unknown = {}) {
  let req = request(app).post('/api/v1/filters');
  for (const [name, value] of Object.entries(headers)) req = req.set(name, value);
  return req.send(body);
}

const LOCAL_HOST = 'filtarr.local:3000';

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

    const json = await postFilters(app, {}, { name: 'x' });
    expect(json.status).toBe(200);
    expect(json.body.body).toEqual({ name: 'x' });

    const charset = await postFilters(app, { 'Content-Type': 'application/json; charset=utf-8' }, '{"name":"y"}');
    expect(charset.status).toBe(200);

    const vendor = await postFilters(app, { 'Content-Type': 'application/vnd.filtarr+json' }, '{"name":"z"}');
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

    const byOrigin = await postFilters(
      app,
      { Host: LOCAL_HOST, Origin: 'https://evil.example', Cookie: 'filtarr.sid=abc' },
      { name: 'x' },
    );
    expect(byOrigin.status).toBe(403);
    expect(byOrigin.body).toEqual({ error: 'Cross-site request rejected' });

    const byReferer = await request(app)
      .delete('/api/v1/instances/1')
      .set('Host', LOCAL_HOST)
      .set('Referer', 'https://evil.example/page');
    expect(byReferer.status).toBe(403);

    const nullOrigin = await postFilters(app, { Host: LOCAL_HOST, Origin: 'null' });
    expect(nullOrigin.status).toBe(403);

    const crossSiteNoOrigin = await postFilters(app, { 'Sec-Fetch-Site': 'cross-site' });
    expect(crossSiteNoOrigin.status).toBe(403);
  });

  it('allows same-origin browser requests and non-browser clients', async () => {
    const app = makeApp();

    const sameOrigin = await postFilters(app, {
      Host: LOCAL_HOST,
      Origin: `http://${LOCAL_HOST}`,
      'Sec-Fetch-Site': 'same-origin',
    });
    expect(sameOrigin.status).toBe(200);

    const fetchSiteOnly = await postFilters(app, { 'Sec-Fetch-Site': 'same-origin' });
    expect(fetchSiteOnly.status).toBe(200);

    const originMatchesHost = await postFilters(app, { Host: LOCAL_HOST, Origin: `http://${LOCAL_HOST}` });
    expect(originMatchesHost.status).toBe(200);

    const noHeaders = await postFilters(app);
    expect(noHeaders.status).toBe(200);

    const safeMethod = await request(app).get('/api/v1/filters').set('Origin', 'https://evil.example');
    expect(safeMethod.status).toBe(200);
  });

  it('exempts x-api-key requests and honors configured CORS origins', async () => {
    const app = makeApp(['https://app.example.com']);

    const apiKey = await postFilters(app, {
      Host: LOCAL_HOST,
      Origin: 'https://evil.example',
      'Sec-Fetch-Site': 'cross-site',
      'X-Api-Key': 'flt_test',
    });
    expect(apiKey.status).toBe(200);

    const corsAllowed = await postFilters(app, {
      Host: LOCAL_HOST,
      Origin: 'https://app.example.com',
      'Sec-Fetch-Site': 'cross-site',
    });
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
  let testDb: FormsTestDatabase;
  let db: FormsTestDatabase['db'];

  beforeEach(() => {
    testDb = openFormsTestDatabase('filtarr-request-policy-');
    db = testDb.db;
  });

  afterEach(() => {
    testDb.cleanup();
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
