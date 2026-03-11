import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { resetConfigCache } from '../../src/config/index.js';
import { closeDatabase, openDatabase } from '../../src/db/index.js';
import { createApp } from '../../src/server/app.js';

describe('app auth and settings flows', () => {
  let app: ReturnType<typeof createApp>;
  let db: ReturnType<typeof openDatabase>;
  let tempDir: string;

  beforeEach(() => {
    resetConfigCache();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filtarr-app-auth-'));
    process.env['FILTARR_DATA_DIR'] = tempDir;
    process.env['NODE_ENV'] = 'test';
    delete process.env['FILTARR_ENABLE_CUSTOM_SCRIPTS'];
    db = openDatabase(tempDir);
    app = createApp(db);
  });

  afterEach(() => {
    closeDatabase(db);
    resetConfigCache();
    delete process.env['FILTARR_DATA_DIR'];
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('completes setup in none mode and serves the auth none-mode endpoints', async () => {
    expect((await request(app).get('/api/v1/setup/status')).body).toEqual({ needsSetup: true });
    expect((await request(app).post('/api/v1/setup/complete').send({ authMode: 'bad' })).status).toBe(400);
    expect((await request(app).post('/api/v1/setup/complete').send({ authMode: 'forms', username: 'admin' })).status).toBe(400);

    const setup = await request(app).post('/api/v1/setup/complete').send({ authMode: 'none' });
    expect(setup.status).toBe(201);
    expect(setup.body.apiKey).toMatch(/^flt_/);
    expect((await request(app).get('/api/v1/setup/status')).body).toEqual({ needsSetup: false });
    expect((await request(app).post('/api/v1/setup/complete').send({ authMode: 'none' })).status).toBe(403);

    expect((await request(app).post('/api/v1/auth/login')).body).toEqual({ success: true, message: 'Auth disabled' });
    expect((await request(app).get('/api/v1/auth/session')).body).toEqual({ authenticated: true, mode: 'none' });
    expect((await request(app).post('/api/v1/auth/logout')).body).toEqual({ success: true });
  });

  it('creates, rotates, lists, and revokes API keys when auth mode is none', async () => {
    db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('auth_mode', 'none', datetime('now'))`).run();
    db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('setup_complete', 'true', datetime('now'))`).run();

    const createKey = await request(app).post('/api/v1/auth/api-keys').send({ name: 'CLI key' });
    expect(createKey.status).toBe(201);
    expect(createKey.body.name).toBe('CLI key');

    const listKeys = await request(app).get('/api/v1/auth/api-keys');
    expect(listKeys.status).toBe(200);
    expect(listKeys.body).toHaveLength(1);

    const rotateMissing = await request(app).post('/api/v1/auth/api-keys/rotate').send({});
    expect(rotateMissing.status).toBe(400);

    const rotate = await request(app)
      .post('/api/v1/auth/api-keys/rotate')
      .send({ keyId: Number(createKey.body.id) });
    expect(rotate.status).toBe(201);
    expect(rotate.body.revokedKeyId).toBe(Number(createKey.body.id));

    const revoke = await request(app).delete(`/api/v1/auth/api-keys/${rotate.body.id}`);
    expect(revoke.body).toEqual({ success: true });
  });

  it('enforces basic-auth protected routes while still exposing basic session state', async () => {
    db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('auth_mode', 'none', datetime('now'))`).run();
    db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('setup_complete', 'true', datetime('now'))`).run();

    const enableBasic = await request(app)
      .put('/api/v1/settings/auth-mode')
      .send({ authMode: 'basic', username: 'admin', password: 'password123' });
    expect(enableBasic.status).toBe(200);

    const unauthenticatedKeys = await request(app).get('/api/v1/auth/api-keys');
    expect(unauthenticatedKeys.status).toBe(401);
    expect(unauthenticatedKeys.headers['www-authenticate']).toBe('Basic realm="Filtarr"');

    expect((await request(app).post('/api/v1/auth/login')).status).toBe(400);
    expect((await request(app).get('/api/v1/auth/session')).body).toEqual({ authenticated: false, mode: 'basic' });

    const authHeader = `Basic ${Buffer.from('admin:password123').toString('base64')}`;
    expect((await request(app).get('/api/v1/auth/session').set('Authorization', authHeader)).body).toEqual({
      authenticated: true,
      mode: 'basic',
    });

    const apiKeys = await request(app).get('/api/v1/auth/api-keys').set('Authorization', authHeader);
    expect(apiKeys.status).toBe(200);
    expect(apiKeys.body).toEqual([]);
  });

  it('updates settings, validates input, and persists notification secrets securely', async () => {
    db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('auth_mode', 'none', datetime('now'))`).run();
    db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('setup_complete', 'true', datetime('now'))`).run();

    expect((await request(app).get('/api/v1/settings/auth-mode')).body).toEqual({ authMode: 'none', hasAdminUser: false });
    expect((await request(app).put('/api/v1/settings/auth-mode').send({ authMode: 'wat' })).status).toBe(400);
    expect((await request(app).put('/api/v1/settings/auth-mode').send({ authMode: 'basic' })).status).toBe(400);

    const authMode = await request(app)
      .put('/api/v1/settings/auth-mode')
      .send({ authMode: 'basic', username: 'admin', password: 'password123' });
    expect(authMode.status).toBe(200);
    expect(db.prepare<[], { count: number }>('SELECT COUNT(*) as count FROM users').get()?.count).toBe(1);

    db.prepare(`UPDATE settings SET value = 'none' WHERE key = 'auth_mode'`).run();
    expect((await request(app).get('/api/v1/settings/app')).body).toEqual({ validationIntervalMinutes: 60 });
    expect((await request(app).put('/api/v1/settings/app').send({ validationIntervalMinutes: 0 })).status).toBe(400);
    expect((await request(app).put('/api/v1/settings/app').send({ validationIntervalMinutes: 15 })).body).toMatchObject({ success: true, validationIntervalMinutes: 15 });

    expect((await request(app).put('/api/v1/settings/notifications').send({ slackWebhookUrl: 12 })).status).toBe(400);
    expect((await request(app).put('/api/v1/settings/notifications').send({ slackWebhookUrl: 'http://127.0.0.1/x' })).status).toBe(400);

    const saved = await request(app)
      .put('/api/v1/settings/notifications')
      .send({ slackEnabled: true, webhookEnabled: false, slackWebhookUrl: 'https://hooks.slack.com/services/T/B/SECRET' });
    expect(saved.status).toBe(200);
    expect((await request(app).get('/api/v1/settings/notifications')).body).toEqual({
      slackEnabled: true,
      slackWebhookUrl: '',
      slackWebhookUrlConfigured: true,
      webhookEnabled: false,
    });
    expect(db.prepare<[], { value: string }>(`SELECT value FROM settings WHERE key = 'slack_webhook_url'`).get()?.value).toMatch(/^enc:/);
  });
});