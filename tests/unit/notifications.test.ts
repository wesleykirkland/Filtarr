import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { resetConfigCache } from '../../src/config/index.js';
import { closeDatabase, openDatabase } from '../../src/db/index.js';
import { createApp } from '../../src/server/app.js';

describe('Notification secret handling', () => {
  let app: ReturnType<typeof createApp>;
  let db: ReturnType<typeof openDatabase>;
  let tempDir: string;

  beforeEach(() => {
    resetConfigCache();

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filtarr-notifications-'));
    process.env['FILTARR_DATA_DIR'] = tempDir;
    process.env['NODE_ENV'] = 'test';
    db = openDatabase(tempDir);
    app = createApp(db);
  });

  afterEach(() => {
    closeDatabase(db);
    resetConfigCache();
    delete process.env['FILTARR_DATA_DIR'];
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('POST /api/v1/filters', () => {
    it('stores notification secrets encrypted and only returns configured metadata', async () => {
      const res = await request(app)
        .post('/api/v1/filters')
        .send({
          name: 'Test Slack Notification Filter',
          triggerSource: 'watcher',
          ruleType: 'extension',
          rulePayload: 'exe',
          actionType: 'notify',
          notifyOnMatch: true,
          notifyWebhookUrl: 'https://example.com/webhook',
          notifySlack: true,
          notifySlackToken: 'xoxb-test-token-12345',
          notifySlackChannel: '#alerts',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('notify_slack', 1);
      expect(res.body).toHaveProperty('notify_slack_token', null);
      expect(res.body).toHaveProperty('notify_slack_token_configured', true);
      expect(res.body).toHaveProperty('notify_slack_channel', '#alerts');
      expect(res.body).toHaveProperty('notify_webhook_url', null);
      expect(res.body).toHaveProperty('notify_webhook_url_configured', true);

      const stored = db
        .prepare<
          [number],
          { notify_webhook_url: string | null; notify_slack_token: string | null }
        >('SELECT notify_webhook_url, notify_slack_token FROM filters WHERE id = ?')
        .get(res.body.id);

      expect(stored?.notify_webhook_url).toMatch(/^enc:/);
      expect(stored?.notify_webhook_url).not.toContain('https://example.com/webhook');
      expect(stored?.notify_slack_token).toMatch(/^enc:/);
      expect(stored?.notify_slack_token).not.toContain('xoxb-test-token-12345');

      const getRes = await request(app).get(`/api/v1/filters/${res.body.id}`);
      expect(getRes.body.notify_webhook_url).toBeNull();
      expect(getRes.body.notify_webhook_url_configured).toBe(true);

      const listRes = await request(app).get('/api/v1/filters');
      expect(listRes.body[0]?.notify_webhook_url).toBeNull();
      expect(listRes.body[0]?.notify_slack_token).toBeNull();
    });
  });

  describe('PUT /api/v1/filters/:id', () => {
    it('preserves secrets when omitted and clears them when empty strings are sent', async () => {
      const createRes = await request(app)
        .post('/api/v1/filters')
        .send({
          name: 'Test Preserve Slack Filter',
          triggerSource: 'manual',
          ruleType: 'size',
          rulePayload: '>100MB',
          actionType: 'notify',
          notifyOnMatch: true,
          notifyWebhookUrl: 'https://example.com/preserve',
          notifySlack: true,
          notifySlackToken: 'xoxb-preserve-token',
          notifySlackChannel: '#preserved',
        });
      expect(createRes.status).toBe(201);
      const filterId = createRes.body.id;

      const updateRes = await request(app)
        .put(`/api/v1/filters/${filterId}`)
        .send({ name: 'Test Preserve Slack Filter Renamed' });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body).toHaveProperty('name', 'Test Preserve Slack Filter Renamed');
      expect(updateRes.body).toHaveProperty('notify_slack', 1);
      expect(updateRes.body).toHaveProperty('notify_slack_token', null);
      expect(updateRes.body).toHaveProperty('notify_slack_token_configured', true);
      expect(updateRes.body).toHaveProperty('notify_webhook_url', null);
      expect(updateRes.body).toHaveProperty('notify_webhook_url_configured', true);
      expect(updateRes.body).toHaveProperty('notify_slack_channel', '#preserved');

      const clearRes = await request(app).put(`/api/v1/filters/${filterId}`).send({
        notifyWebhookUrl: '',
        notifySlackToken: '',
        notifySlackChannel: '',
      });

      expect(clearRes.status).toBe(200);
      expect(clearRes.body).toHaveProperty('notify_webhook_url_configured', false);
      expect(clearRes.body).toHaveProperty('notify_slack_token_configured', false);
      expect(clearRes.body).toHaveProperty('notify_slack_channel', null);

      const stored = db
        .prepare<
          [number],
          {
            notify_webhook_url: string | null;
            notify_slack_token: string | null;
            notify_slack_channel: string | null;
          }
        >('SELECT notify_webhook_url, notify_slack_token, notify_slack_channel FROM filters WHERE id = ?')
        .get(filterId);

      expect(stored?.notify_webhook_url).toBeNull();
      expect(stored?.notify_slack_token).toBeNull();
      expect(stored?.notify_slack_channel).toBeNull();
    });
  });

  describe('global notification settings', () => {
    describe('GET /api/v1/settings/notifications', () => {
      it('returns independent enable flags without echoing the stored Slack webhook secret', async () => {
        const putRes = await request(app)
          .put('/api/v1/settings/notifications')
          .send({
            slackEnabled: true,
            webhookEnabled: false,
            slackWebhookUrl: 'https://hooks.slack.com/services/T000/B000/SECRET',
          });

        expect(putRes.status).toBe(200);

        const res = await request(app).get('/api/v1/settings/notifications');

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
          slackEnabled: true,
          slackWebhookUrl: '',
          slackWebhookUrlConfigured: true,
          webhookEnabled: false,
        });

        const stored = db
          .prepare<[], { value: string }>(`SELECT value FROM settings WHERE key = 'slack_webhook_url'`)
          .get();
        expect(stored?.value).toMatch(/^enc:/);
        expect(stored?.value).not.toContain('https://hooks.slack.com/services/T000/B000/SECRET');

        const clearRes = await request(app)
          .put('/api/v1/settings/notifications')
          .send({ slackWebhookUrl: '' });
        expect(clearRes.status).toBe(200);

        const cleared = await request(app).get('/api/v1/settings/notifications');
        expect(cleared.body.slackWebhookUrlConfigured).toBe(false);
      });
    });
  });
});
