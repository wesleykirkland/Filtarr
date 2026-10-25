import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import {
  FILTER_SECRET_CONTEXTS,
  createFilter,
  updateFilter,
} from '../../src/db/schemas/filters.js';
import { decryptStoredSecret } from '../../src/services/encryption.js';
import { createInstance } from '../../src/db/schemas/instances.js';

describe('filter updates', () => {
  it('updates filters when instanceId is provided', () => {
    const db = new Database(':memory:');

    try {
      runMigrations(db);

      const instance = createInstance(db, {
        name: 'Radarr',
        type: 'radarr',
        url: 'http://localhost:7878',
        apiKey: 'test-api-key',
      });

      const filter = createFilter(db, {
        name: 'Block EXE/MSI Files',
        triggerSource: 'watcher',
        ruleType: 'extension',
        rulePayload: 'exe',
        actionType: 'blocklist',
        instanceId: instance.id,
        enabled: true,
      });

      const updated = updateFilter(db, filter.id, {
        name: 'Block EXE/MSI Files 2',
        rulePayload: 'msi',
        instanceId: instance.id,
        overrideNotifications: true,
        notifyOnMatch: true,
        notifyWebhookUrl: 'https://example.com/webhook',
        enabled: true,
      });

      expect(updated.name).toBe('Block EXE/MSI Files 2');
      expect(updated.rule_payload).toBe('msi');
      expect(updated.instance_id).toBe(instance.id);
      expect(updated.override_notifications).toBe(1);
      expect(updated.notify_on_match).toBe(1);
      expect(updated.notify_webhook_url).toMatch(/^enc:v2:/);
      expect(
        decryptStoredSecret(updated.notify_webhook_url, undefined, FILTER_SECRET_CONTEXTS.webhookUrl),
      ).toBe('https://example.com/webhook');
    } finally {
      db.close();
    }
  });

  it('persists a shell script runtime for custom filters', () => {
    const db = new Database(':memory:');

    try {
      runMigrations(db);

      const filter = createFilter(db, {
        name: 'Shell Script Filter',
        triggerSource: 'watcher',
        ruleType: 'script',
        rulePayload: 'echo true',
        actionType: 'script',
        actionPayload: 'echo "$FILTARR_FILE_PATH"',
        scriptRuntime: 'shell',
        enabled: true,
      });

      const updated = updateFilter(db, filter.id, {
        scriptRuntime: 'javascript',
      });

      expect(filter.script_runtime).toBe('shell');
      expect(updated.script_runtime).toBe('javascript');
    } finally {
      db.close();
    }
  });

  it('encrypts notification secrets at rest and keeps them on masked or omitted updates', () => {
    const db = new Database(':memory:');

    try {
      runMigrations(db);

      const filter = createFilter(db, {
        name: 'Encrypted Secrets',
        triggerSource: 'watcher',
        ruleType: 'extension',
        rulePayload: 'exe',
        actionType: 'notify',
        overrideNotifications: true,
        notifyOnMatch: true,
        notifyWebhookUrl: 'https://hooks.example.com/secret-path',
        notifySlack: true,
        notifySlackToken: 'xoxb-plain-token',
        notifySlackChannel: '#alerts',
      });

      const raw = db
        .prepare<[number], { notify_webhook_url: string; notify_slack_token: string }>(
          'SELECT notify_webhook_url, notify_slack_token FROM filters WHERE id = ?',
        )
        .get(filter.id);
      expect(raw?.notify_webhook_url).toMatch(/^enc:v2:/);
      expect(raw?.notify_slack_token).toMatch(/^enc:v2:/);
      expect(JSON.stringify(raw)).not.toContain('secret-path');
      expect(JSON.stringify(raw)).not.toContain('xoxb-plain-token');
      // Ciphertext is bound to its column and cannot be swapped between them.
      expect(() =>
        decryptStoredSecret(raw?.notify_slack_token, undefined, FILTER_SECRET_CONTEXTS.webhookUrl),
      ).toThrow();

      const masked = updateFilter(db, filter.id, {
        notifyWebhookUrl: '••••••••path',
        notifySlackToken: '••••••••oken',
      });
      expect(masked.notify_webhook_url).toBe(raw?.notify_webhook_url);
      expect(masked.notify_slack_token).toBe(raw?.notify_slack_token);

      const omitted = updateFilter(db, filter.id, { name: 'Renamed' });
      expect(omitted.notify_slack_token).toBe(raw?.notify_slack_token);

      const rotated = updateFilter(db, filter.id, { notifySlackToken: 'xoxb-rotated' });
      expect(
        decryptStoredSecret(rotated.notify_slack_token, undefined, FILTER_SECRET_CONTEXTS.slackToken),
      ).toBe('xoxb-rotated');

      const cleared = updateFilter(db, filter.id, { notifyWebhookUrl: '' });
      expect(cleared.notify_webhook_url).toBeNull();
    } finally {
      db.close();
    }
  });
});
