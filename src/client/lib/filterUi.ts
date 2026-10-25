import {
  DEFAULT_BLOCKLIST_BEHAVIOR,
  isBlocklistBehavior,
  type BlocklistBehavior,
} from '../../shared/blocklistBehavior';

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

export type ArrBehavior = BlocklistBehavior;

export interface ArrBehaviorOption {
  value: ArrBehavior;
  label: string;
  description: string;
}

export const ARR_BEHAVIOR_OPTIONS: ArrBehaviorOption[] = [
  {
    value: 'blocklist_and_search',
    label: 'Blocklist & Search',
    description: 'Blocklists the release and lets the Arr search for a replacement.',
  },
  {
    value: 'blocklist_only',
    label: 'Blocklist Only',
    description: 'Blocklists the release without searching for a replacement.',
  },
  {
    value: 'remove_only',
    label: 'Remove Only (Don\'t Blocklist)',
    description: 'Removes from queue without blocklisting. The Arr may re-grab the same release.',
  },
];

export const ARR_BEHAVIOR_BADGE: Record<ArrBehavior, { text: string; className: string }> = {
  blocklist_and_search: {
    text: 'BLOCKLIST & SEARCH',
    className: 'bg-red-500/20 text-red-400',
  },
  blocklist_only: {
    text: 'BLOCKLIST ONLY',
    className: 'bg-orange-500/20 text-orange-400',
  },
  remove_only: {
    text: 'REMOVE ONLY',
    className: 'bg-yellow-500/20 text-yellow-400',
  },
};

export function getArrBehavior(actionPayload?: string | null): ArrBehavior {
  return isBlocklistBehavior(actionPayload) ? actionPayload : DEFAULT_BLOCKLIST_BEHAVIOR;
}

export type FilterActionType = 'blocklist' | 'delete' | 'move' | 'script' | 'notify';

/**
 * The actionPayload value to submit for a given action type. Always explicit:
 * blocklist sends a valid behavior, payload-less actions send '' so an edit
 * clears any stale value on the server (undefined would keep it).
 */
export function buildActionPayload(actionType: FilterActionType, actionPayload: string): string {
  switch (actionType) {
    case 'blocklist':
      return getArrBehavior(actionPayload);
    case 'move':
    case 'script':
      return actionPayload;
    default:
      return '';
  }
}

/**
 * The actionPayload to keep when the action type select changes. The payload
 * is only reset when switching into or out of 'blocklist' (whose payload is a
 * behavior enum); move/script/delete flips keep what the user typed.
 */
export function actionPayloadAfterTypeChange(
  previousType: FilterActionType,
  nextType: FilterActionType,
  actionPayload: string,
): string {
  const crossesBlocklist = (previousType === 'blocklist') !== (nextType === 'blocklist');
  return crossesBlocklist ? '' : actionPayload;
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
