import { describe, expect, it } from 'vitest';
import {
  actionPayloadAfterTypeChange,
  ARR_BEHAVIOR_BADGE,
  ARR_BEHAVIOR_OPTIONS,
  buildActionPayload,
  canDeleteFilter,
  getArrBehavior,
  FILTER_CARD_CLASS_NAME,
  getFilterNotificationChannels,
  hasConfiguredPath,
  trimToUndefined,
} from '../../src/client/lib/filterUi';
import { BLOCKLIST_BEHAVIORS } from '../../src/shared/blocklistBehavior';

describe('filterUi helpers', () => {
  it('treats blank values as undefined', () => {
    expect(trimToUndefined('   ')).toBeUndefined();
    expect(trimToUndefined(' /downloads ')).toBe('/downloads');
  });

  it('detects whether a filter has a usable target path', () => {
    expect(hasConfiguredPath('/downloads')).toBe(true);
    expect(hasConfiguredPath('   ')).toBe(false);
    expect(hasConfiguredPath()).toBe(false);
  });

  it('keeps filter cards dark-mode-safe', () => {
    expect(FILTER_CARD_CLASS_NAME).toContain('bg-white/95');
    expect(FILTER_CARD_CLASS_NAME).toContain('dark:bg-gray-900/60');
    expect(FILTER_CARD_CLASS_NAME).toContain('dark:hover:border-gray-700/70');
  });

  it('prevents deletion for built-in filters', () => {
    expect(canDeleteFilter({ is_built_in: 0 })).toBe(true);
    expect(canDeleteFilter({ is_built_in: 1 })).toBe(false);
  });

  it('returns both webhook and Slack notification channels when enabled', () => {
    expect(
      getFilterNotificationChannels({
        notify_on_match: 1,
        notify_webhook_url: 'https://example.com/hook',
        notify_slack: 1,
        notify_slack_channel: '#alerts',
        override_notifications: 1,
      }),
    ).toEqual([
      { key: 'webhook', label: 'Webhook', detail: 'https://example.com/hook' },
      { key: 'slack', label: 'Slack', detail: '#alerts' },
    ]);
  });

  it('returns inherited notification channels when a filter uses defaults', () => {
    expect(
      getFilterNotificationChannels(
        {
          notify_on_match: 0,
          notify_webhook_url: null,
          notify_slack: 0,
          notify_slack_channel: null,
          override_notifications: 0,
        },
        {
          webhookEnabled: true,
          slackEnabled: true,
          defaultWebhookUrl: 'https://example.com/default-webhook',
          defaultSlackToken: 'xoxb-default-token',
          defaultSlackChannel: '#default-alerts',
        },
      ),
    ).toEqual([
      { key: 'inherited', label: 'Inherited', detail: 'Uses Settings defaults' },
      { key: 'default-webhook', label: 'Webhook', detail: 'Settings default' },
      { key: 'default-slack', label: 'Slack', detail: '#default-alerts' },
    ]);
  });
});

describe('blocklist behavior helpers', () => {
  it.each([
    [null, 'blocklist_and_search'],
    [undefined, 'blocklist_and_search'],
    ['', 'blocklist_and_search'],
    ['blocklist_and_search', 'blocklist_and_search'],
    ['blocklist_only', 'blocklist_only'],
    ['remove_only', 'remove_only'],
    ['do_not_blocklist', 'blocklist_and_search'],
    ['garbage', 'blocklist_and_search'],
  ])('getArrBehavior(%j) -> %s', (input, expected) => {
    expect(getArrBehavior(input)).toBe(expected);
  });

  it('has an option and a badge for every shared behavior', () => {
    expect(ARR_BEHAVIOR_OPTIONS.map((o) => o.value)).toEqual([...BLOCKLIST_BEHAVIORS]);
    expect(Object.keys(ARR_BEHAVIOR_BADGE).sort()).toEqual([...BLOCKLIST_BEHAVIORS].sort());
  });

  it('builds an explicit actionPayload for each action type', () => {
    expect(buildActionPayload('blocklist', '')).toBe('blocklist_and_search');
    expect(buildActionPayload('blocklist', 'blocklist_only')).toBe('blocklist_only');
    expect(buildActionPayload('move', '/mnt/q')).toBe('/mnt/q');
    expect(buildActionPayload('script', 'echo hi')).toBe('echo hi');
    expect(buildActionPayload('delete', '/stale')).toBe('');
    expect(buildActionPayload('notify', 'stale')).toBe('');
  });

  it('only resets the payload when switching into or out of blocklist', () => {
    expect(actionPayloadAfterTypeChange('move', 'script', '/mnt/q')).toBe('/mnt/q');
    expect(actionPayloadAfterTypeChange('move', 'delete', '/mnt/q')).toBe('/mnt/q');
    expect(actionPayloadAfterTypeChange('move', 'blocklist', '/mnt/q')).toBe('');
    expect(actionPayloadAfterTypeChange('blocklist', 'move', 'blocklist_only')).toBe('');
    expect(actionPayloadAfterTypeChange('blocklist', 'blocklist', 'blocklist_only')).toBe('blocklist_only');
  });
});
