import { describe, expect, it } from 'vitest';
import {
  canDeleteFilter,
  FILTER_CARD_CLASS_NAME,
  getFilterNotificationChannels,
  hasConfiguredPath,
  trimToUndefined,
} from '../../src/client/lib/filterUi';

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
