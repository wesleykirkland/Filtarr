import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../components/Toast';
import { api } from '../../lib/api';
import type {
  NotificationChannel,
  NotificationSettingsResponse,
  NotificationSettingsUpdate,
} from './types';

export default function SettingsNotificationsPage() {
  const queryClient = useQueryClient();
  const [slackEnabled, setSlackEnabled] = useState(false);
  const [webhookEnabled, setWebhookEnabled] = useState(false);
  const [defaultWebhookUrl, setDefaultWebhookUrl] = useState('');
  const [defaultSlackToken, setDefaultSlackToken] = useState('');
  const [defaultSlackChannel, setDefaultSlackChannel] = useState('');
  const [notificationSettingsHydrated, setNotificationSettingsHydrated] = useState(false);
  const [testingChannel, setTestingChannel] = useState<NotificationChannel | null>(null);

  const { data: notificationSettings } = useQuery({
    queryKey: ['settings', 'notifications'],
    queryFn: () => api.get<NotificationSettingsResponse>('/settings/notifications'),
  });

  useEffect(() => {
    if (!notificationSettings || notificationSettingsHydrated) return;

    setSlackEnabled(notificationSettings.slackEnabled);
    setWebhookEnabled(notificationSettings.webhookEnabled);
    // Stored secrets are never returned in plaintext; inputs only hold newly typed values.
    setDefaultWebhookUrl('');
    setDefaultSlackToken('');
    setDefaultSlackChannel(notificationSettings.defaultSlackChannel);
    setNotificationSettingsHydrated(true);
  }, [notificationSettings, notificationSettingsHydrated]);

  const updateNotificationSettingsMutation = useMutation({
    mutationFn: (data: NotificationSettingsUpdate) =>
      api.put<{ success: boolean; message: string }>('/settings/notifications', data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'notifications'] });
      toast('success', data.message);
    },
    onError: (err: Error) => {
      toast('error', err.message);
    },
  });

  const testNotificationChannelMutation = useMutation({
    mutationFn: (data: {
      channel: NotificationChannel;
      defaultWebhookUrl?: string;
      defaultSlackToken?: string;
      defaultSlackChannel?: string;
    }) => api.post<{ success: boolean; message: string }>('/settings/notifications/test', data),
    onSuccess: (data) => {
      toast('success', data.message);
    },
    onError: (err: Error) => {
      toast('error', err.message);
    },
    onSettled: () => {
      setTestingChannel(null);
    },
  });

  const normalizedDefaultWebhookUrl = defaultWebhookUrl.trim();
  const normalizedDefaultSlackToken = defaultSlackToken.trim();
  const normalizedDefaultSlackChannel = defaultSlackChannel.trim();
  const hasSlackToken =
    Boolean(normalizedDefaultSlackToken) || Boolean(notificationSettings?.hasDefaultSlackToken);
  const hasWebhookUrl =
    Boolean(normalizedDefaultWebhookUrl) || Boolean(notificationSettings?.hasDefaultWebhookUrl);
  const notificationSettingsChanged = notificationSettings
    ? notificationSettings.slackEnabled !== slackEnabled ||
      notificationSettings.webhookEnabled !== webhookEnabled ||
      Boolean(normalizedDefaultWebhookUrl) ||
      Boolean(normalizedDefaultSlackToken) ||
      notificationSettings.defaultSlackChannel !== normalizedDefaultSlackChannel
    : false;

  const handleSaveNotificationSettings = () => {
    if (
      (normalizedDefaultSlackToken && !normalizedDefaultSlackChannel) ||
      (!hasSlackToken && normalizedDefaultSlackChannel)
    ) {
      toast('error', 'Default Slack notifications require both a bot token and a channel');
      return;
    }

    setDefaultWebhookUrl('');
    setDefaultSlackToken('');
    setDefaultSlackChannel(normalizedDefaultSlackChannel);

    // Secrets are only sent when the user typed a new value; omitted means "keep existing".
    updateNotificationSettingsMutation.mutate({
      slackEnabled,
      webhookEnabled,
      defaultWebhookUrl: normalizedDefaultWebhookUrl || undefined,
      defaultSlackToken: normalizedDefaultSlackToken || undefined,
      defaultSlackChannel: normalizedDefaultSlackChannel,
    });
  };

  const handleTestNotificationChannel = (channel: NotificationChannel) => {
    if (channel === 'slack') {
      if (!hasSlackToken || !normalizedDefaultSlackChannel) {
        toast('error', 'Default Slack notifications require both a bot token and a channel');
        return;
      }

      setDefaultSlackToken(normalizedDefaultSlackToken);
      setDefaultSlackChannel(normalizedDefaultSlackChannel);
      setTestingChannel(channel);
      testNotificationChannelMutation.mutate({
        channel,
        defaultSlackToken: normalizedDefaultSlackToken || undefined,
        defaultSlackChannel: normalizedDefaultSlackChannel,
      });
      return;
    }

    if (!hasWebhookUrl) {
      toast('error', 'Default webhook URL is required to send a webhook test');
      return;
    }

    setDefaultWebhookUrl(normalizedDefaultWebhookUrl);
    setTestingChannel(channel);
    testNotificationChannelMutation.mutate({
      channel,
      defaultWebhookUrl: normalizedDefaultWebhookUrl || undefined,
    });
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Notifications</h3>
      <p className="mt-1 max-w-2xl text-sm text-gray-600 dark:text-gray-400">
        Configure the global master switches and default destinations. Filters inherit these
        notification settings unless you explicitly override them on an individual filter.
      </p>

      <div className="mt-4 space-y-4">
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-800/40">
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              id="slackEnabled"
              checked={slackEnabled}
              onChange={(e) => setSlackEnabled(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-gray-300 bg-white text-blue-600 dark:border-gray-700 dark:bg-gray-950"
            />
            <div className="space-y-1">
              <label htmlFor="slackEnabled" className="text-sm font-medium text-gray-900 dark:text-gray-100">
                Enable Slack notifications
              </label>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Acts as the global master switch for both inherited defaults and per-filter Slack overrides.
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="settings-default-slack-token" className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                Default Slack Bot Token
              </label>
              <input
                id="settings-default-slack-token"
                value={defaultSlackToken}
                onChange={(e) => setDefaultSlackToken(e.target.value)}
                placeholder={
                  notificationSettings?.hasDefaultSlackToken
                    ? `Configured (${notificationSettings.defaultSlackToken}) - leave blank to keep`
                    : 'xoxb-...'
                }
                className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
              />
            </div>
            <div>
              <label htmlFor="settings-default-slack-channel" className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                Default Slack Channel
              </label>
              <input
                id="settings-default-slack-channel"
                value={defaultSlackChannel}
                onChange={(e) => setDefaultSlackChannel(e.target.value)}
                placeholder="#alerts"
                className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
            Used by filters that inherit the default Slack destination.
          </p>

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => handleTestNotificationChannel('slack')}
              disabled={testingChannel !== null}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              {testingChannel === 'slack' ? 'Sending Slack Test...' : 'Send Slack Test'}
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-800/40">
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              id="webhookEnabled"
              checked={webhookEnabled}
              onChange={(e) => setWebhookEnabled(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-gray-300 bg-white text-blue-600 dark:border-gray-700 dark:bg-gray-950"
            />
            <div className="space-y-1">
              <label htmlFor="webhookEnabled" className="text-sm font-medium text-gray-900 dark:text-gray-100">
                Enable webhook notifications
              </label>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Acts as the global master switch for both inherited defaults and per-filter webhook overrides.
              </p>
            </div>
          </div>

          <div className="mt-4">
            <label htmlFor="settings-default-webhook-url" className="block text-xs font-medium text-gray-700 dark:text-gray-300">
              Default Webhook URL
            </label>
            <input
              id="settings-default-webhook-url"
              type="url"
              value={defaultWebhookUrl}
              onChange={(e) => setDefaultWebhookUrl(e.target.value)}
              placeholder={
                notificationSettings?.hasDefaultWebhookUrl
                  ? `Configured (${notificationSettings.defaultWebhookUrl}) - leave blank to keep`
                  : 'https://discord.com/api/webhooks/...'
              }
              className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
            />
            <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
              Used by filters that inherit the default webhook destination.
            </p>
          </div>

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => handleTestNotificationChannel('webhook')}
              disabled={testingChannel !== null}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              {testingChannel === 'webhook' ? 'Sending Webhook Test...' : 'Send Webhook Test'}
            </button>
          </div>
        </div>

        <div className="pt-2">
          <button
            onClick={handleSaveNotificationSettings}
            disabled={
              updateNotificationSettingsMutation.isPending ||
              !notificationSettings ||
              !notificationSettingsChanged
            }
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {updateNotificationSettingsMutation.isPending ? 'Saving...' : 'Save Notification Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}