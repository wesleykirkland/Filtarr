import dns from 'node:dns';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FILTER_SECRET_CONTEXTS, type FilterRow } from '../../src/db/schemas/filters.js';
import { encryptStoredSecret } from '../../src/services/encryption.js';
import { logger } from '../../src/server/lib/logger.js';
import {
  NOTIFICATION_TIMEOUT_MS,
  NotificationService,
} from '../../src/server/services/NotificationService.js';

const SLACK_URL = 'https://slack.com/api/chat.postMessage';
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

function makeFilter(overrides: Partial<FilterRow> = {}): FilterRow {
  return {
    id: 1,
    name: 'Notify Filter',
    description: null,
    trigger_source: 'watcher',
    rule_type: 'extension',
    rule_payload: 'mkv',
    action_type: 'notify',
    action_payload: null,
    script_runtime: 'javascript',
    target_path: '/downloads',
    is_built_in: 0,
    notify_on_match: 1,
    notify_webhook_url: 'https://example.com/webhook',
    notify_slack: 1,
    notify_slack_token: 'xoxb-test-token',
    notify_slack_channel: '#alerts',
    override_notifications: 1,
    instance_id: null,
    enabled: 1,
    sort_order: 0,
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    ...overrides,
  };
}

describe('NotificationService', () => {
  let db: Database.Database;
  let service: NotificationService;

  beforeEach(() => {
    mockFetch.mockReset();
    // Webhook hosts are resolved before sending; keep tests off the real network.
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as never);

    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT
      );
    `);

    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('slack_enabled', '1');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('webhook_enabled', '1');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('default_webhook_url', '');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('default_slack_token', '');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('default_slack_channel', '');

    service = new NotificationService(db);
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  it('fans out filter matches to webhook and Slack when both destinations are enabled', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });

    await service.notifyFilterMatch(makeFilter(), {
      path: '/downloads/movie/file.mkv',
      name: 'file.mkv',
      size: 42,
      extension: 'mkv',
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);

    const webhookCall = mockFetch.mock.calls.find(([url]) => url === 'https://example.com/webhook');
    const slackCall = mockFetch.mock.calls.find(([url]) => url === 'https://slack.com/api/chat.postMessage');

    expect(webhookCall).toBeTruthy();
    expect(slackCall).toBeTruthy();
    expect(JSON.parse(webhookCall?.[1].body as string)).toMatchObject({
      event: 'filter_match',
      filter: { id: 1, name: 'Notify Filter' },
      file: { name: 'file.mkv', path: '/downloads/movie/file.mkv', size: 42 },
    });
    expect(slackCall?.[1].headers).toMatchObject({
      Authorization: 'Bearer xoxb-test-token',
    });
    expect(JSON.parse(slackCall?.[1].body as string)).toMatchObject({
      channel: '#alerts',
    });
  });

  it('still attempts the other destination when one notification target fails', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('webhook down'))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });

    await expect(
      service.notifyFilterMatch(makeFilter(), {
        path: '/downloads/movie/file.mkv',
        name: 'file.mkv',
        size: 42,
        extension: 'mkv',
      }),
    ).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('uses inherited default destinations when a filter does not override notifications', async () => {
    db.prepare('UPDATE settings SET value = ? WHERE key = ?')
      .run('https://example.com/default-webhook', 'default_webhook_url');
    db.prepare('UPDATE settings SET value = ? WHERE key = ?')
      .run('xoxb-default-token', 'default_slack_token');
    db.prepare('UPDATE settings SET value = ? WHERE key = ?')
      .run('#default-alerts', 'default_slack_channel');

    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });

    await service.notifyFilterMatch(
      makeFilter({
        override_notifications: 0,
        notify_webhook_url: 'https://example.com/custom-webhook',
        notify_slack_token: 'xoxb-custom-token',
        notify_slack_channel: '#custom-alerts',
      }),
      {
        path: '/downloads/movie/file.mkv',
        name: 'file.mkv',
        size: 42,
        extension: 'mkv',
      },
    );

    expect(mockFetch).toHaveBeenCalledTimes(2);

    const webhookCall = mockFetch.mock.calls.find(
      ([url]) => url === 'https://example.com/default-webhook',
    );
    const slackCall = mockFetch.mock.calls.find(([url]) => url === 'https://slack.com/api/chat.postMessage');

    expect(webhookCall).toBeTruthy();
    expect(slackCall?.[1].headers).toMatchObject({
      Authorization: 'Bearer xoxb-default-token',
    });
    expect(JSON.parse(slackCall?.[1].body as string)).toMatchObject({
      channel: '#default-alerts',
    });
  });

  it('skips Slack delivery when no token/channel are available', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    await service.notifyFilterMatch(
      makeFilter({ notify_slack_token: null, notify_slack_channel: null }),
      {
        path: '/downloads/movie/file.mkv',
        name: 'file.mkv',
        size: 42,
        extension: 'mkv',
      },
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(
      mockFetch.mock.calls.some(([url]) => url === 'https://slack.com/api/chat.postMessage'),
    ).toBe(false);
  });

  it('uses only enabled preferred channels for instance healthcheck failures', async () => {
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('0', 'webhook_enabled');
    db.prepare('UPDATE settings SET value = ? WHERE key = ?')
      .run('https://example.com/health-webhook', 'default_webhook_url');
    db.prepare('UPDATE settings SET value = ? WHERE key = ?')
      .run('xoxb-health-token', 'default_slack_token');
    db.prepare('UPDATE settings SET value = ? WHERE key = ?')
      .run('#health-alerts', 'default_slack_channel');

    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });

    await service.notifyInstanceHealthcheckFailure(
      {
        id: 7,
        name: 'Primary Sonarr',
        type: 'sonarr',
        url: 'http://sonarr.local',
      },
      'Unauthorized: invalid API key',
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://slack.com/api/chat.postMessage',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer xoxb-health-token' }),
      }),
    );

    expect(JSON.parse(mockFetch.mock.calls[0]?.[1].body as string)).toMatchObject({
      channel: '#health-alerts',
    });
    expect(JSON.parse(mockFetch.mock.calls[0]?.[1].body as string).text).toContain(
      'Filtarr instance healthcheck failed: Primary Sonarr',
    );
  });

  const fileEvent = {
    path: '/downloads/movie/file.mkv',
    name: 'file.mkv',
    size: 42,
    extension: 'mkv',
  };

  it('logs a warning with channel, host, and reason when a webhook fetch rejects', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    // Webhook delivery awaits DNS resolution first, so route responses by URL, not call order.
    mockFetch.mockImplementation(async (url: string) => {
      if (url === SLACK_URL) return { ok: true, status: 200, json: async () => ({ ok: true }) };
      throw new Error('connect ECONNREFUSED');
    });

    await expect(
      service.notifyFilterMatch(
        makeFilter({ notify_webhook_url: 'https://hooks.example.com/secret-token-path?key=abc' }),
        fileEvent,
      ),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        filterId: 1,
        deliveryChannel: 'webhook',
        host: 'hooks.example.com',
        reason: 'connect ECONNREFUSED',
      }),
      'Webhook notification failed',
    );
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain('secret-token-path');
    expect(logged).not.toContain('key=abc');
  });

  it('logs a warning without leaking the token when the Slack fetch rejects', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    mockFetch.mockImplementation(async (url: string) => {
      if (url === SLACK_URL) throw new Error('socket hang up');
      return { ok: true, status: 200 };
    });

    await expect(service.notifyFilterMatch(makeFilter(), fileEvent)).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryChannel: 'slack', host: 'slack.com', reason: 'socket hang up' }),
      'Slack notification failed',
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('xoxb-test-token');
  });

  it('logs a warning and skips the request when the webhook URL is invalid', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });

    await expect(
      service.notifyFilterMatch(
        makeFilter({ notify_webhook_url: 'http://insecure.example.com/hook' }),
        fileEvent,
      ),
    ).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith('https://slack.com/api/chat.postMessage', expect.anything());
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryChannel: 'webhook',
        host: 'insecure.example.com',
        reason: expect.any(String),
      }),
      'Webhook notification failed',
    );
  });

  it('reports an unparseable webhook URL without logging it', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('0', 'slack_enabled');
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(
      'not a url secret-123',
      'default_webhook_url',
    );

    await expect(
      service.notifyInstanceHealthcheckFailure(
        { id: 7, name: 'Primary Sonarr', type: 'sonarr', url: 'http://sonarr.local' },
        'down',
      ),
    ).resolves.toBeUndefined();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ instanceId: 7, deliveryChannel: 'webhook', host: 'invalid-url' }),
      'Webhook healthcheck notification failed',
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-123');
  });

  it('passes a timeout signal to every fetch and reports timeouts clearly', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const timeoutError = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    mockFetch.mockRejectedValueOnce(timeoutError).mockRejectedValueOnce(timeoutError);

    await service.notifyFilterMatch(makeFilter(), fileEvent);

    expect(timeoutSpy).toHaveBeenCalledWith(NOTIFICATION_TIMEOUT_MS);
    for (const [, init] of mockFetch.mock.calls) {
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryChannel: 'webhook',
        reason: `Request timed out after ${NOTIFICATION_TIMEOUT_MS}ms`,
      }),
      'Webhook notification failed',
    );
  });

  it('still surfaces validation errors from test notifications to the caller', async () => {
    await expect(
      service.sendTestNotification('webhook', { defaultWebhookUrl: 'http://insecure.example.com' }),
    ).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('refuses to send a webhook whose host resolves to a private address', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    vi.mocked(dns.promises.lookup).mockResolvedValue([
      { address: '203.0.114.10', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ] as never);
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });

    await service.notifyFilterMatch(
      makeFilter({ notify_webhook_url: 'https://rebind.attacker.example/hook' }),
      fileEvent,
    );

    expect(dns.promises.lookup).toHaveBeenCalledWith('rebind.attacker.example', {
      all: true,
      verbatim: true,
    });
    expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([SLACK_URL]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryChannel: 'webhook',
        reason: 'Webhook URL resolves to localhost or a private network',
      }),
      'Webhook notification failed',
    );
  });

  it('rejects a test webhook that resolves to an IPv4-mapped loopback address', async () => {
    vi.mocked(dns.promises.lookup).mockResolvedValue([
      { address: '::ffff:127.0.0.1', family: 6 },
    ] as never);

    await expect(
      service.sendTestNotification('webhook', { defaultWebhookUrl: 'https://mapped.example/hook' }),
    ).rejects.toThrow('private network');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('pins the webhook connection and refuses redirects for webhook and Slack', async () => {
    mockFetch.mockImplementation(async (url: string) =>
      url === SLACK_URL
        ? { ok: true, status: 200, json: async () => ({ ok: true }) }
        : { ok: true, status: 200 },
    );

    await service.notifyFilterMatch(makeFilter(), fileEvent);

    const webhookInit = mockFetch.mock.calls.find(([url]) => url !== SLACK_URL)?.[1];
    const slackInit = mockFetch.mock.calls.find(([url]) => url === SLACK_URL)?.[1];
    expect(webhookInit).toMatchObject({ redirect: 'error' });
    expect(webhookInit.dispatcher).toBeDefined();
    expect(slackInit).toMatchObject({ redirect: 'error' });
  });

  it('treats a redirect response as a delivery failure', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('0', 'slack_enabled');
    mockFetch.mockRejectedValue(new TypeError('fetch failed: unexpected redirect'));

    await service.notifyFilterMatch(makeFilter(), fileEvent);

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryChannel: 'webhook', reason: 'fetch failed: unexpected redirect' }),
      'Webhook notification failed',
    );
  });

  it('decrypts per-filter secrets stored with their column context', async () => {
    mockFetch.mockImplementation(async (url: string) =>
      url === SLACK_URL
        ? { ok: true, status: 200, json: async () => ({ ok: true }) }
        : { ok: true, status: 200 },
    );

    await service.notifyFilterMatch(
      makeFilter({
        notify_webhook_url: encryptStoredSecret(
          'https://example.com/encrypted-hook',
          undefined,
          FILTER_SECRET_CONTEXTS.webhookUrl,
        ),
        notify_slack_token: encryptStoredSecret(
          'xoxb-encrypted',
          undefined,
          FILTER_SECRET_CONTEXTS.slackToken,
        ),
      }),
      fileEvent,
    );

    expect(mockFetch.mock.calls.some(([url]) => url === 'https://example.com/encrypted-hook')).toBe(true);
    const slackInit = mockFetch.mock.calls.find(([url]) => url === SLACK_URL)?.[1];
    expect(slackInit.headers).toMatchObject({ Authorization: 'Bearer xoxb-encrypted' });
  });
});
