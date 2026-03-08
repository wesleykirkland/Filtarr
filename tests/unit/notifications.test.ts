/**
 * Tests the notification inheritance contract.
 * Filters inherit default notification destinations from Settings unless they
 * explicitly enable per-filter overrides.
 */
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/app.js';
import { getDatabase } from '../../src/db/index.js';
import { createInstance } from '../../src/db/schemas/instances.js';

describe('Filter notification overrides', () => {
  const app = createApp();
  let createdFilterId: number;

  afterAll(async () => {
    if (createdFilterId) {
      await request(app).delete(`/api/v1/filters/${createdFilterId}`);
    }
  });

  describe('POST /api/v1/filters', () => {
    it('creates a filter with per-filter notification overrides', async () => {
      const res = await request(app)
        .post('/api/v1/filters')
        .send({
          name: 'Test Slack Notification Filter',
          triggerSource: 'watcher',
          ruleType: 'extension',
          rulePayload: 'exe',
          actionType: 'notify',
          overrideNotifications: true,
          notifySlack: true,
          notifySlackToken: 'xoxb-test-token-12345',
          notifySlackChannel: '#alerts',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('override_notifications', 1);
      expect(res.body).toHaveProperty('notify_slack', 1);
      expect(res.body).toHaveProperty('notify_slack_token', 'xoxb-test-token-12345');
      expect(res.body).toHaveProperty('notify_slack_channel', '#alerts');
      createdFilterId = res.body.id;
    });

    it('creates a filter that inherits default notifications by default', async () => {
      const res = await request(app)
        .post('/api/v1/filters')
        .send({
          name: 'Test Webhook Only Filter',
          triggerSource: 'watcher',
          ruleType: 'extension',
          rulePayload: 'iso',
          actionType: 'notify',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('override_notifications', 0);
      expect(res.body).toHaveProperty('notify_on_match', 0);
      expect(res.body).toHaveProperty('notify_webhook_url', null);
      expect(res.body).toHaveProperty('notify_slack', 0);
      expect(res.body).toHaveProperty('notify_slack_token', null);
      expect(res.body).toHaveProperty('notify_slack_channel', null);

      await request(app).delete(`/api/v1/filters/${res.body.id}`);
    });
  });

  describe('PUT /api/v1/filters/:id', () => {
    it('updates filter fields including instance and notification settings', async () => {
      const db = getDatabase();
      const instance = createInstance(db, {
        name: `Test Update Instance ${Date.now()}`,
        type: 'sonarr',
        url: 'http://localhost:8990',
        apiKey: 'test-api-key',
      });

      const createRes = await request(app)
        .post('/api/v1/filters')
        .send({
          name: `Test Full Update Filter ${Date.now()}`,
          triggerSource: 'watcher',
          ruleType: 'extension',
          rulePayload: 'mkv',
          actionType: 'notify',
        });
      expect(createRes.status).toBe(201);

      const filterId = createRes.body.id;

      const updateRes = await request(app)
        .put(`/api/v1/filters/${filterId}`)
        .send({
          name: 'Test Full Update Filter Renamed',
          instanceId: instance.id,
          overrideNotifications: true,
          notifyOnMatch: true,
          notifyWebhookUrl: 'https://example.com/filter-webhook',
          notifySlack: true,
          notifySlackToken: 'xoxb-full-update-token',
          notifySlackChannel: '#full-update',
          enabled: false,
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body).toHaveProperty('name', 'Test Full Update Filter Renamed');
      expect(updateRes.body).toHaveProperty('instance_id', instance.id);
      expect(updateRes.body).toHaveProperty('override_notifications', 1);
      expect(updateRes.body).toHaveProperty('notify_on_match', 1);
      expect(updateRes.body).toHaveProperty('notify_webhook_url', 'https://example.com/filter-webhook');
      expect(updateRes.body).toHaveProperty('notify_slack', 1);
      expect(updateRes.body).toHaveProperty('notify_slack_token', 'xoxb-full-update-token');
      expect(updateRes.body).toHaveProperty('notify_slack_channel', '#full-update');
      expect(updateRes.body).toHaveProperty('enabled', 0);

      await request(app).delete(`/api/v1/filters/${filterId}`);
      db.prepare('DELETE FROM arr_instances WHERE id = ?').run(instance.id);
    });

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
          overrideNotifications: true,
          notifySlack: true,
          notifySlackToken: 'xoxb-updated-token',
          notifySlackChannel: 'C01234567',
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body).toHaveProperty('override_notifications', 1);
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
          overrideNotifications: true,
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
      expect(updateRes.body).toHaveProperty('override_notifications', 1);
      expect(updateRes.body).toHaveProperty('notify_slack', 1);
      expect(updateRes.body).toHaveProperty('notify_slack_token', 'xoxb-preserve-token');
      expect(updateRes.body).toHaveProperty('notify_slack_channel', '#preserved');

      await request(app).delete(`/api/v1/filters/${filterId}`);
    });

    it('can switch a filter back to inheriting the default notifications', async () => {
      const createRes = await request(app)
        .post('/api/v1/filters')
        .send({
          name: `Test Inherited Notifications ${Date.now()}`,
          triggerSource: 'watcher',
          ruleType: 'extension',
          rulePayload: 'avi',
          actionType: 'notify',
          overrideNotifications: true,
          notifyOnMatch: true,
          notifyWebhookUrl: 'https://example.com/custom-webhook',
          notifySlack: true,
          notifySlackToken: 'xoxb-custom-token',
          notifySlackChannel: '#custom',
        });
      expect(createRes.status).toBe(201);

      const filterId = createRes.body.id;

      const updateRes = await request(app)
        .put(`/api/v1/filters/${filterId}`)
        .send({ overrideNotifications: false });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body).toHaveProperty('override_notifications', 0);
      expect(updateRes.body).toHaveProperty('notify_on_match', 1);
      expect(updateRes.body).toHaveProperty('notify_webhook_url', 'https://example.com/custom-webhook');
      expect(updateRes.body).toHaveProperty('notify_slack', 1);
      expect(updateRes.body).toHaveProperty('notify_slack_token', 'xoxb-custom-token');
      expect(updateRes.body).toHaveProperty('notify_slack_channel', '#custom');

      await request(app).delete(`/api/v1/filters/${filterId}`);
    });

    it('clears stale missing instance links instead of crashing on update', async () => {
      const db = getDatabase();
      const uniqueName = `Test Stale Instance Filter ${Date.now()}`;

      db.pragma('foreign_keys = OFF');

      const insertResult = db
        .prepare(
          `INSERT INTO filters (
             name, description, trigger_source, rule_type, rule_payload,
             action_type, action_payload, target_path,
             notify_on_match, notify_webhook_url, notify_slack,
             notify_slack_token, notify_slack_channel,
             override_notifications,
             instance_id,
             enabled, sort_order, created_at, updated_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        )
        .run(
          uniqueName,
          'Has a stale linked instance',
          'watcher',
          'extension',
          'nzb',
          'notify',
          null,
          null,
          1,
          'https://example.com/stale-webhook',
          1,
          'xoxb-stale-token',
          '#stale',
          1,
          999999,
          1,
          0,
        );

      db.pragma('foreign_keys = ON');

      const filterId = Number(insertResult.lastInsertRowid);

      try {
        const updateRes = await request(app)
          .put(`/api/v1/filters/${filterId}`)
          .send({ name: `${uniqueName} Renamed` });

        expect(updateRes.status).toBe(200);
        expect(updateRes.body).toHaveProperty('name', `${uniqueName} Renamed`);
        expect(updateRes.body).toHaveProperty('instance_id', null);
        expect(updateRes.body).toHaveProperty('override_notifications', 1);
        expect(updateRes.body).toHaveProperty('notify_webhook_url', 'https://example.com/stale-webhook');
        expect(updateRes.body).toHaveProperty('notify_slack', 1);
        expect(updateRes.body).toHaveProperty('notify_slack_token', 'xoxb-stale-token');
        expect(updateRes.body).toHaveProperty('notify_slack_channel', '#stale');
      } finally {
        db.prepare('DELETE FROM filters WHERE id = ?').run(filterId);
      }
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
      expect(res.body).toHaveProperty('defaultWebhookUrl');
      expect(res.body).toHaveProperty('defaultSlackToken');
      expect(res.body).toHaveProperty('defaultSlackChannel');
      expect(typeof res.body.slackEnabled).toBe('boolean');
      expect(typeof res.body.webhookEnabled).toBe('boolean');
    });
  });

  describe('PUT /api/v1/settings/notifications', () => {
    it('updates Slack and webhook enable flags independently', async () => {
      const res1 = await request(app)
        .put('/api/v1/settings/notifications')
        .send({
          slackEnabled: true,
          webhookEnabled: false,
          defaultWebhookUrl: 'https://example.com/default-webhook',
          defaultSlackToken: 'xoxb-default-token',
          defaultSlackChannel: '#default-alerts',
        });

      expect(res1.status).toBe(200);
      expect(res1.body).toHaveProperty('success', true);

      const getRes1 = await request(app).get('/api/v1/settings/notifications');
      expect(getRes1.body.slackEnabled).toBe(true);
      expect(getRes1.body.webhookEnabled).toBe(false);
      expect(getRes1.body.defaultWebhookUrl).toBe('https://example.com/default-webhook');
      expect(getRes1.body.defaultSlackToken).toBe('xoxb-default-token');
      expect(getRes1.body.defaultSlackChannel).toBe('#default-alerts');

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
        .send({
          slackEnabled: false,
          webhookEnabled: true,
          defaultWebhookUrl: 'https://example.com/original-webhook',
          defaultSlackToken: 'xoxb-original-token',
          defaultSlackChannel: '#original-alerts',
        });

      const res = await request(app)
        .put('/api/v1/settings/notifications')
        .send({ slackEnabled: true });

      expect(res.status).toBe(200);

      const getRes = await request(app).get('/api/v1/settings/notifications');
      expect(getRes.body.slackEnabled).toBe(true);
      expect(getRes.body.webhookEnabled).toBe(true);
      expect(getRes.body.defaultWebhookUrl).toBe('https://example.com/original-webhook');
      expect(getRes.body.defaultSlackToken).toBe('xoxb-original-token');
      expect(getRes.body.defaultSlackChannel).toBe('#original-alerts');
    });
  });
});


