import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilterRow } from '../../src/db/schemas/filters.js';
import { NotificationService } from '../../src/server/services/NotificationService.js';

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
});
