import { describe, expect, it } from 'vitest';
import type { FilterRow } from '../../src/db/schemas/filters.js';
import { getWatcherPaths, isPathWithinTarget } from '../../src/server/services/filterPaths.js';

function makeFilter(overrides: Partial<FilterRow> = {}): FilterRow {
  return {
    id: 1,
    name: 'Test Filter',
    description: null,
    trigger_source: 'watcher',
    rule_type: 'extension',
    rule_payload: 'mkv',
    action_type: 'notify',
    action_payload: null,
    script_runtime: 'javascript',
    target_path: '/downloads',
    is_built_in: 0,
    notify_on_match: 0,
    notify_webhook_url: null,
    notify_slack: 0,
    notify_slack_token: null,
    notify_slack_channel: null,
    override_notifications: 0,
    instance_id: null,
    enabled: 1,
    sort_order: 0,
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    ...overrides,
  };
}

describe('filter watcher paths', () => {
  it('aggregates only enabled filters with valid absolute target paths', () => {
    const watcherPaths = getWatcherPaths([
      makeFilter({ id: 1, target_path: '/downloads' }),
      makeFilter({ id: 2, target_path: ' /downloads ' }),
      makeFilter({ id: 3, target_path: '/media/incoming' }),
      makeFilter({ id: 4, trigger_source: 'cron', target_path: '/cron-only' }),
      makeFilter({ id: 5, target_path: 'relative/path' }),
      makeFilter({ id: 6, target_path: '   ' }),
      makeFilter({ id: 7, target_path: null }),
      makeFilter({ id: 8, enabled: 0, target_path: '/disabled' }),
    ]);

    expect(watcherPaths).toEqual(['/downloads', '/media/incoming']);
  });

  it('matches only files inside the configured target directory', () => {
    expect(isPathWithinTarget('/downloads/movie/file.mkv', '/downloads')).toBe(true);
    expect(isPathWithinTarget('/downloads-archive/file.mkv', '/downloads')).toBe(false);
  });
});
