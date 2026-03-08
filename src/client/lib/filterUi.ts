export interface FilterNotificationState {
  notify_on_match: number;
  notify_webhook_url?: string | null;
  notify_slack: number;
  notify_slack_channel?: string | null;
  override_notifications: number;
}

export interface NotificationDefaultsState {
  webhookEnabled: boolean;
  slackEnabled: boolean;
  defaultWebhookUrl?: string | null;
  defaultSlackToken?: string | null;
  defaultSlackChannel?: string | null;
}

export interface FilterDeletionState {
  is_built_in: number;
}

export const FILTER_CARD_CLASS_NAME =
  'group relative overflow-hidden rounded-2xl border border-gray-200 bg-white/95 p-5 transition-all hover:shadow-xl dark:border-gray-800 dark:bg-gray-900/60 dark:hover:border-gray-700/70';

export interface FilterNotificationChannel {
  key: string;
  label: string;
  detail?: string;
}

export function trimToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function hasConfiguredPath(targetPath?: string | null): boolean {
  return typeof targetPath === 'string' && targetPath.trim().length > 0;
}

export function canDeleteFilter(filter: FilterDeletionState): boolean {
  return filter.is_built_in === 0;
}

export function getFilterNotificationChannels(
  filter: FilterNotificationState,
  defaults?: NotificationDefaultsState,
): FilterNotificationChannel[] {
  if (filter.override_notifications !== 1) {
    const channels: FilterNotificationChannel[] = [
      {
        key: 'inherited',
        label: 'Inherited',
        detail: 'Uses Settings defaults',
      },
    ];

    const defaultWebhookUrl = trimToUndefined(defaults?.defaultWebhookUrl ?? '');
    const defaultSlackToken = trimToUndefined(defaults?.defaultSlackToken ?? '');
    const defaultSlackChannel = trimToUndefined(defaults?.defaultSlackChannel ?? '');

    if (defaults?.webhookEnabled && defaultWebhookUrl) {
      channels.push({
        key: 'default-webhook',
        label: 'Webhook',
        detail: 'Settings default',
      });
    }

    if (defaults?.slackEnabled && defaultSlackToken && defaultSlackChannel) {
      channels.push({
        key: 'default-slack',
        label: 'Slack',
        detail: defaultSlackChannel,
      });
    }

    return channels;
  }

  const channels: FilterNotificationChannel[] = [];

  if (filter.notify_on_match) {
    channels.push({
      key: 'webhook',
      label: 'Webhook',
      detail: trimToUndefined(filter.notify_webhook_url ?? ''),
    });
  }

  if (filter.notify_slack) {
    channels.push({
      key: 'slack',
      label: 'Slack',
      detail: trimToUndefined(filter.notify_slack_channel ?? ''),
    });
  }

  return channels;
}
