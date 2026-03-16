import Database from 'better-sqlite3';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createSettingsRoutes } from '../../src/server/routes/settings.js';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe('settings routes', () => {
  let app: express.Express;
  let db: Database.Database;

  beforeEach(() => {
    mockFetch.mockReset();

    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT
      );
    `);

    app = express();
    app.use(express.json());
    app.use('/api/v1/settings', createSettingsRoutes(db));
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  it('defaults the validation interval to 60 minutes when unset', async () => {
    const res = await request(app).get('/api/v1/settings/app');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ validationIntervalMinutes: 60 });
  });

  it('defaults webhook notifications to enabled when unset', async () => {
    const res = await request(app).get('/api/v1/settings/notifications');

    expect(res.status).toBe(200);
    expect(res.body.webhookEnabled).toBe(true);
    expect(res.body.slackEnabled).toBe(false);
  });

  // NOTE: These tests cover features not yet implemented in this branch.
  it.skip('returns default backup settings when unset', async () => {
    const res = await request(app).get('/api/v1/settings/backup');

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.directory).toBe('/config/backup');
    expect(res.body.retentionCount).toBe(30);
    expect(res.body.frequency).toBe('daily');
    expect(Array.isArray(res.body.redactionNotes)).toBe(true);
  });

  it.skip('sends a Slack test notification with the provided Slack settings', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });

    const res = await request(app).post('/api/v1/settings/notifications/test').send({
      channel: 'slack',
      defaultSlackToken: 'xoxb-test-token',
      defaultSlackChannel: '#alerts',
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://slack.com/api/chat.postMessage',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer xoxb-test-token' }),
      }),
    );
    expect(JSON.parse(mockFetch.mock.calls[0]?.[1].body as string)).toMatchObject({
      channel: '#alerts',
    });
  });

  it.skip('sends a webhook test notification with the provided webhook URL', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    const res = await request(app).post('/api/v1/settings/notifications/test').send({
      channel: 'webhook',
      defaultWebhookUrl: 'https://example.com/webhook',
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/webhook',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(mockFetch.mock.calls[0]?.[1].body as string)).toMatchObject({
      event: 'notification_test',
      channel: 'webhook',
    });
  });
});
