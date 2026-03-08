import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { createFilter, updateFilter } from '../../src/db/schemas/filters.js';
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
      expect(updated.notify_webhook_url).toBe('https://example.com/webhook');
    } finally {
      db.close();
    }
  });
});
