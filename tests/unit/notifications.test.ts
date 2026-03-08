/**
 * Tests for per-filter Slack notification contract and global notification settings.
 * Verifies the corrected contract: filters own their Slack credentials (token/channel),
 * while global settings provide independent enable flags for Slack and webhook.
 */
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/app.js';

describe('Per-filter Slack notification contract', () => {
  const app = createApp();
  let createdFilterId: number;

  afterAll(async () => {
    if (createdFilterId) {
      await request(app).delete(`/api/v1/filters/${createdFilterId}`);
    }
  });

  describe('POST /api/v1/filters', () => {
    it('creates a filter with per-filter Slack token and channel', async () => {
      const res = await request(app)
        .post('/api/v1/filters')
        .send({
          name: 'Test Slack Notification Filter',
          triggerSource: 'watcher',
          ruleType: 'extension',
          rulePayload: 'exe',
          actionType: 'notify',
          notifySlack: true,
          notifySlackToken: 'xoxb-test-token-12345',
          notifySlackChannel: '#alerts',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('notify_slack', 1);
      expect(res.body).toHaveProperty('notify_slack_token', 'xoxb-test-token-12345');
      expect(res.body).toHaveProperty('notify_slack_channel', '#alerts');
      createdFilterId = res.body.id;
    });

    it('creates a filter without Slack credentials (null values)', async () => {
      const res = await request(app)
        .post('/api/v1/filters')
        .send({
          name: 'Test Webhook Only Filter',
          triggerSource: 'watcher',
          ruleType: 'extension',
          rulePayload: 'iso',
          actionType: 'notify',
          notifyOnMatch: true,
          notifyWebhookUrl: 'https://example.com/webhook',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('notify_slack', 0);
      expect(res.body).toHaveProperty('notify_slack_token', null);
      expect(res.body).toHaveProperty('notify_slack_channel', null);
      expect(res.body).toHaveProperty('notify_webhook_url', 'https://example.com/webhook');

      await request(app).delete(`/api/v1/filters/${res.body.id}`);
    });
  });

  describe('PUT /api/v1/filters/:id', () => {
    it('updates per-filter Slack credentials', async () => {
      const createRes = await request(app)
        .post('/api/v1/filters')
        .send({
          name: 'Test Update Slack Filter',
          triggerSource: 'watcher',
          ruleType: 'regex',
          rulePayload: '.*\\.sample$',
          actionType: 'delete',
        });
      expect(createRes.status).toBe(201);
      const filterId = createRes.body.id;

      const updateRes = await request(app)
        .put(`/api/v1/filters/${filterId}`)
        .send({
          notifySlack: true,
          notifySlackToken: 'xoxb-updated-token',
          notifySlackChannel: 'C01234567',
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body).toHaveProperty('notify_slack', 1);
      expect(updateRes.body).toHaveProperty('notify_slack_token', 'xoxb-updated-token');
      expect(updateRes.body).toHaveProperty('notify_slack_channel', 'C01234567');

      await request(app).delete(`/api/v1/filters/${filterId}`);
    });

    it('preserves Slack credentials when not provided in update', async () => {
      const createRes = await request(app)
        .post('/api/v1/filters')
        .send({
          name: 'Test Preserve Slack Filter',
          triggerSource: 'manual',
          ruleType: 'size',
          rulePayload: '>100MB',
          actionType: 'notify',
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
      expect(updateRes.body).toHaveProperty('notify_slack_token', 'xoxb-preserve-token');
      expect(updateRes.body).toHaveProperty('notify_slack_channel', '#preserved');

      await request(app).delete(`/api/v1/filters/${filterId}`);
    });
  });
});

describe('Global notification settings', () => {
  const app = createApp();

  describe('GET /api/v1/settings/notifications', () => {
    it('returns independent Slack and webhook enable flags', async () => {
      const res = await request(app).get('/api/v1/settings/notifications');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('slackEnabled');
      expect(res.body).toHaveProperty('webhookEnabled');
      expect(res.body).toHaveProperty('slackWebhookUrl');
      expect(typeof res.body.slackEnabled).toBe('boolean');
      expect(typeof res.body.webhookEnabled).toBe('boolean');
    });
  });

  describe('PUT /api/v1/settings/notifications', () => {
    it('updates Slack and webhook enable flags independently', async () => {
      const res1 = await request(app)
        .put('/api/v1/settings/notifications')
        .send({ slackEnabled: true, webhookEnabled: false });

      expect(res1.status).toBe(200);
      expect(res1.body).toHaveProperty('success', true);

      const getRes1 = await request(app).get('/api/v1/settings/notifications');
      expect(getRes1.body.slackEnabled).toBe(true);
      expect(getRes1.body.webhookEnabled).toBe(false);

      const res2 = await request(app)
        .put('/api/v1/settings/notifications')
        .send({ slackEnabled: true, webhookEnabled: true });

      expect(res2.status).toBe(200);

      const getRes2 = await request(app).get('/api/v1/settings/notifications');
      expect(getRes2.body.slackEnabled).toBe(true);
      expect(getRes2.body.webhookEnabled).toBe(true);
    });

    it('allows partial updates (only update slackEnabled)', async () => {
      await request(app)
        .put('/api/v1/settings/notifications')
        .send({ slackEnabled: false, webhookEnabled: true });

      const res = await request(app)
        .put('/api/v1/settings/notifications')
        .send({ slackEnabled: true });

      expect(res.status).toBe(200);

      const getRes = await request(app).get('/api/v1/settings/notifications');
      expect(getRes.body.slackEnabled).toBe(true);
      expect(getRes.body.webhookEnabled).toBe(true);
    });
  });
});

