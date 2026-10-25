import path from 'node:path';
import Database from 'better-sqlite3';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createSettingsRoutes } from '../../src/server/routes/settings.js';
import { decryptStoredSecret } from '../../src/services/encryption.js';
import { NotificationService } from '../../src/server/services/NotificationService.js';
import type { FilterRow } from '../../src/db/schemas/filters.js';
import type { FileEvent } from '../../src/server/services/filterEngine.js';

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

  it('defaults the validation interval to 15 minutes when unset', async () => {
    const res = await request(app).get('/api/v1/settings/app');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ validationIntervalMinutes: 15 });
  });

  it('defaults webhook notifications to disabled when unset', async () => {
    const res = await request(app).get('/api/v1/settings/notifications');

    expect(res.status).toBe(200);
    expect(res.body.webhookEnabled).toBe(false);
    expect(res.body.slackEnabled).toBe(false);
  });

  it('returns default backup settings when unset', async () => {
    const res = await request(app).get('/api/v1/settings/backup');

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.directory).toBe(path.resolve(process.env['FILTARR_DATA_DIR'] ?? '', 'backup'));
    expect(res.body.retentionCount).toBe(30);
    expect(res.body.frequency).toBe('daily');
    expect(Array.isArray(res.body.redactionNotes)).toBe(true);
  });

  it('rejects a backup directory outside the data directory', async () => {
    const res = await request(app).put('/api/v1/settings/backup').send({ directory: '/etc' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Backup directory must be inside the Filtarr data directory');
  });

  it('sends a Slack test notification with the provided Slack settings', async () => {
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

  it('sends a webhook test notification with the provided webhook URL', async () => {
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

  function readStoredSetting(key: string): string | undefined {
    return db.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?').get(key)
      ?.value;
  }

  describe('secret notification settings', () => {
    const slackToken = 'xoxb-secret-token-abcd';
    const webhookUrl = 'https://hooks.example.com/secret/wxyz';

    async function saveSecrets() {
      const res = await request(app).put('/api/v1/settings/notifications').send({
        slackEnabled: true,
        webhookEnabled: true,
        defaultWebhookUrl: webhookUrl,
        defaultSlackToken: slackToken,
        defaultSlackChannel: '#alerts',
      });
      expect(res.status).toBe(200);
    }

    it('encrypts the default Slack token and webhook URL at rest', async () => {
      await saveSecrets();

      const storedToken = readStoredSetting('default_slack_token');
      const storedWebhook = readStoredSetting('default_webhook_url');
      expect(storedToken).toMatch(/^enc:/);
      expect(storedWebhook).toMatch(/^enc:/);
      expect(decryptStoredSecret(storedToken)).toBe(slackToken);
      expect(decryptStoredSecret(storedWebhook)).toBe(webhookUrl);
      expect(readStoredSetting('default_slack_channel')).toBe('#alerts');
    });

    it('returns masked secrets and configured flags on GET', async () => {
      await saveSecrets();

      const res = await request(app).get('/api/v1/settings/notifications');

      expect(res.status).toBe(200);
      expect(res.body.defaultSlackToken).toBe('••••••••abcd');
      expect(res.body.defaultWebhookUrl).toBe('••••••••wxyz');
      expect(res.body.hasDefaultSlackToken).toBe(true);
      expect(res.body.hasDefaultWebhookUrl).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain(slackToken);
      expect(JSON.stringify(res.body)).not.toContain(webhookUrl);
    });

    it('reports unconfigured secrets as empty', async () => {
      const res = await request(app).get('/api/v1/settings/notifications');

      expect(res.body.defaultSlackToken).toBe('');
      expect(res.body.hasDefaultSlackToken).toBe(false);
      expect(res.body.hasDefaultWebhookUrl).toBe(false);
    });

    it('keeps the stored secrets when PUT sends empty, omitted, or masked values', async () => {
      await saveSecrets();
      const storedToken = readStoredSetting('default_slack_token');
      const storedWebhook = readStoredSetting('default_webhook_url');

      await request(app)
        .put('/api/v1/settings/notifications')
        .send({ defaultSlackToken: '', defaultWebhookUrl: '••••••••wxyz', defaultSlackChannel: '#ops' })
        .expect(200);
      await request(app).put('/api/v1/settings/notifications').send({ slackEnabled: false }).expect(200);

      expect(readStoredSetting('default_slack_token')).toBe(storedToken);
      expect(readStoredSetting('default_webhook_url')).toBe(storedWebhook);
      expect(readStoredSetting('default_slack_channel')).toBe('#ops');
    });

    it('clears a stored secret when PUT sends null', async () => {
      await saveSecrets();

      await request(app)
        .put('/api/v1/settings/notifications')
        .send({ defaultSlackToken: null })
        .expect(200);

      expect(readStoredSetting('default_slack_token') ?? '').toBe('');
      const res = await request(app).get('/api/v1/settings/notifications').expect(200);
      expect(res.body.hasDefaultSlackToken).toBe(false);
    });

    it('overwrites the stored secret when a new value is supplied', async () => {
      await saveSecrets();

      await request(app)
        .put('/api/v1/settings/notifications')
        .send({ defaultSlackToken: 'xoxb-rotated-token' })
        .expect(200);

      expect(decryptStoredSecret(readStoredSetting('default_slack_token'))).toBe('xoxb-rotated-token');
    });

    it('sends notifications with the decrypted stored Slack token', async () => {
      await saveSecrets();
      mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });

      const filter = {
        id: 1,
        name: 'Test filter',
        override_notifications: 0,
        notify_on_match: 1,
        notify_slack: 1,
      } as unknown as FilterRow;
      const file = { path: '/downloads/file.exe', name: 'file.exe', size: 1, extension: 'exe' } satisfies FileEvent;

      await new NotificationService(db).notifyFilterMatch(filter, file);

      const slackCall = mockFetch.mock.calls.find(([url]) => url === 'https://slack.com/api/chat.postMessage');
      expect(slackCall?.[1]).toMatchObject({
        headers: expect.objectContaining({ Authorization: `Bearer ${slackToken}` }),
      });
      expect(mockFetch.mock.calls.some(([url]) => url === webhookUrl)).toBe(true);
    });

    it('uses the decrypted stored Slack token for test notifications when none is supplied', async () => {
      await saveSecrets();
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });

      const res = await request(app).post('/api/v1/settings/notifications/test').send({
        channel: 'slack',
        defaultSlackToken: '••••••••abcd',
        defaultSlackChannel: '#alerts',
      });

      expect(res.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://slack.com/api/chat.postMessage',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: `Bearer ${slackToken}` }),
        }),
      );
    });
  });

  describe('OIDC client secret', () => {
    const oidcPayload = {
      issuerUrl: 'https://issuer.example.com/realms/filtarr',
      clientId: 'filtarr-web',
      clientSecret: 'oidc-super-secret-1234',
      callbackUrl: 'http://localhost:9898/api/v1/auth/oidc/callback',
      scopes: ['openid', 'profile'],
    };

    beforeEach(() => {
      db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, password_hash TEXT)`);
    });

    it('encrypts on write, masks on read, and preserves on empty PUT', async () => {
      await request(app)
        .put('/api/v1/settings/auth-mode')
        .send({ authMode: 'none', oidc: oidcPayload })
        .expect(200);

      const stored = readStoredSetting('oidc_client_secret');
      expect(stored).toMatch(/^enc:/);
      expect(decryptStoredSecret(stored)).toBe(oidcPayload.clientSecret);

      const getRes = await request(app).get('/api/v1/settings/auth-mode').expect(200);
      expect(getRes.body.oidc.clientSecret).toBe('••••••••1234');
      expect(getRes.body.oidc.hasClientSecret).toBe(true);

      await request(app)
        .put('/api/v1/settings/auth-mode')
        .send({ authMode: 'none', oidc: { ...oidcPayload, clientSecret: '' } })
        .expect(200);
      expect(readStoredSetting('oidc_client_secret')).toBe(stored);
    });
  });
});