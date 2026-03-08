import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';
import { toast } from '../components/Toast';

type AuthMode = 'none' | 'basic' | 'forms';

interface ApiKeyResponse {
  id: number;
  name: string;
  maskedKey: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  revoked: boolean;
}

interface RotateResponse {
  id: number;
  name: string;
  apiKey: string;
  maskedKey: string;
  message: string;
  revokedKeyId: number;
}

interface AuthModeResponse {
  authMode: AuthMode;
  hasAdminUser: boolean;
}

interface ChangeAuthModeResponse {
  success: boolean;
  authMode: AuthMode;
  message: string;
}

interface AppSettingsResponse {
  validationIntervalMinutes: number;
}

interface NotificationSettingsResponse {
  slackEnabled: boolean;
  webhookEnabled: boolean;
  defaultWebhookUrl: string;
  defaultSlackToken: string;
  defaultSlackChannel: string;
}

export default function Settings() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmRotate, setConfirmRotate] = useState<number | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Auth mode change state
  const [showAuthModeChange, setShowAuthModeChange] = useState(false);
  const [selectedAuthMode, setSelectedAuthMode] = useState<AuthMode>('none');
  const [authUsername, setAuthUsername] = useState('admin');
  const [authPassword, setAuthPassword] = useState('');
  const [confirmAuthChange, setConfirmAuthChange] = useState(false);

  const { data: authModeData } = useQuery({
    queryKey: ['settings', 'auth-mode'],
    queryFn: () => api.get<AuthModeResponse>('/settings/auth-mode'),
  });

  const { data: apiKeys, isLoading: loadingKeys } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => api.get<ApiKeyResponse[]>('/auth/api-keys'),
  });

  const { data: appSettings } = useQuery({
    queryKey: ['settings', 'app'],
    queryFn: () => api.get<AppSettingsResponse>('/settings/app'),
  });

  const { data: notificationSettings } = useQuery({
    queryKey: ['settings', 'notifications'],
    queryFn: () => api.get<NotificationSettingsResponse>('/settings/notifications'),
  });

  const [validationInterval, setValidationInterval] = useState('60');
  const [slackEnabled, setSlackEnabled] = useState(false);
  const [webhookEnabled, setWebhookEnabled] = useState(true);
  const [defaultWebhookUrl, setDefaultWebhookUrl] = useState('');
  const [defaultSlackToken, setDefaultSlackToken] = useState('');
  const [defaultSlackChannel, setDefaultSlackChannel] = useState('');
  const [notificationSettingsHydrated, setNotificationSettingsHydrated] = useState(false);

  // Sync validationInterval to fetched state once
  useQuery({
    queryKey: ['settings', 'app', 'sync'],
    queryFn: () => {
      if (appSettings) setValidationInterval(appSettings.validationIntervalMinutes.toString());
      return null;
    },
    enabled: !!appSettings && validationInterval === '60', // only fire if still default
  });

  useEffect(() => {
    if (!notificationSettings || notificationSettingsHydrated) return;

    setSlackEnabled(notificationSettings.slackEnabled);
    setWebhookEnabled(notificationSettings.webhookEnabled);
    setDefaultWebhookUrl(notificationSettings.defaultWebhookUrl);
    setDefaultSlackToken(notificationSettings.defaultSlackToken);
    setDefaultSlackChannel(notificationSettings.defaultSlackChannel);
    setNotificationSettingsHydrated(true);
  }, [notificationSettings, notificationSettingsHydrated]);

  const updateAppSettingsMutation = useMutation({
    mutationFn: (data: { validationIntervalMinutes: number }) =>
      api.put<{ success: boolean; message: string }>('/settings/app', data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'app'] });
      toast('success', data.message);
    },
    onError: (err: Error) => {
      toast('error', err.message);
    },
  });

  const updateNotificationSettingsMutation = useMutation({
    mutationFn: (data: NotificationSettingsResponse) =>
      api.put<{ success: boolean; message: string }>('/settings/notifications', data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'notifications'] });
      toast('success', data.message);
    },
    onError: (err: Error) => {
      toast('error', err.message);
    },
  });

  const handleSaveGeneralSettings = () => {
    const val = parseInt(validationInterval, 10);
    if (isNaN(val) || val < 1) {
      toast('error', 'Validation interval must be at least 1 minute');
      return;
    }
    updateAppSettingsMutation.mutate({ validationIntervalMinutes: val });
  };

  const normalizedDefaultWebhookUrl = defaultWebhookUrl.trim();
  const normalizedDefaultSlackToken = defaultSlackToken.trim();
  const normalizedDefaultSlackChannel = defaultSlackChannel.trim();
  const notificationSettingsChanged = notificationSettings
    ? notificationSettings.slackEnabled !== slackEnabled ||
      notificationSettings.webhookEnabled !== webhookEnabled ||
      notificationSettings.defaultWebhookUrl !== normalizedDefaultWebhookUrl ||
      notificationSettings.defaultSlackToken !== normalizedDefaultSlackToken ||
      notificationSettings.defaultSlackChannel !== normalizedDefaultSlackChannel
    : false;

  const handleSaveNotificationSettings = () => {
    if (
      (normalizedDefaultSlackToken && !normalizedDefaultSlackChannel) ||
      (!normalizedDefaultSlackToken && normalizedDefaultSlackChannel)
    ) {
      toast('error', 'Default Slack notifications require both a bot token and a channel');
      return;
    }

    setDefaultWebhookUrl(normalizedDefaultWebhookUrl);
    setDefaultSlackToken(normalizedDefaultSlackToken);
    setDefaultSlackChannel(normalizedDefaultSlackChannel);

    updateNotificationSettingsMutation.mutate({
      slackEnabled,
      webhookEnabled,
      defaultWebhookUrl: normalizedDefaultWebhookUrl,
      defaultSlackToken: normalizedDefaultSlackToken,
      defaultSlackChannel: normalizedDefaultSlackChannel,
    });
  };

  const changeAuthModeMutation = useMutation({
    mutationFn: (data: { authMode: AuthMode; username?: string; password?: string }) =>
      api.put<ChangeAuthModeResponse>('/settings/auth-mode', data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'auth-mode'] });
      queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
      toast('success', data.message);
      setShowAuthModeChange(false);
      setConfirmAuthChange(false);
      setAuthPassword('');

      // Redirect based on new auth mode
      if (data.authMode === 'forms') {
        navigate('/login', { replace: true });
      }
    },
    onError: (err: Error) => {
      toast('error', err.message);
      setConfirmAuthChange(false);
    },
  });

  const rotateMutation = useMutation({
    mutationFn: (keyId: number) => api.post<RotateResponse>('/auth/api-keys/rotate', { keyId }),
    onSuccess: (data) => {
      setNewKey(data.apiKey);
      setConfirmRotate(null);
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      toast('success', 'API key rotated successfully');
    },
    onError: (err: Error) => {
      toast('error', err.message);
      setConfirmRotate(null);
    },
  });

  const copyKey = async (key: string) => {
    await navigator.clipboard.writeText(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAuthModeSubmit = () => {
    const needsCredentials = selectedAuthMode !== 'none' && !authModeData?.hasAdminUser;
    changeAuthModeMutation.mutate({
      authMode: selectedAuthMode,
      username: needsCredentials ? authUsername : undefined,
      password: needsCredentials ? authPassword : undefined,
    });
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Settings</h2>

      {/* Notifications */}
      <div className="rounded-xl border dark:border-gray-800 border-gray-200 dark:bg-gray-900 bg-white shadow-sm p-6">
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
                <label
                  htmlFor="slackEnabled"
                  className="text-sm font-medium text-gray-900 dark:text-gray-100"
                >
                  Enable Slack notifications
                </label>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Acts as the global master switch for both inherited defaults and per-filter Slack
                  overrides.
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                  Default Slack Bot Token
                </label>
                <input
                  value={defaultSlackToken}
                  onChange={(e) => setDefaultSlackToken(e.target.value)}
                  placeholder="xoxb-..."
                  className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                  Default Slack Channel
                </label>
                <input
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
                <label
                  htmlFor="webhookEnabled"
                  className="text-sm font-medium text-gray-900 dark:text-gray-100"
                >
                  Enable webhook notifications
                </label>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Acts as the global master switch for both inherited defaults and per-filter
                  webhook overrides.
                </p>
              </div>
            </div>

            <div className="mt-4">
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                Default Webhook URL
              </label>
              <input
                type="url"
                value={defaultWebhookUrl}
                onChange={(e) => setDefaultWebhookUrl(e.target.value)}
                placeholder="https://discord.com/api/webhooks/..."
                className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
              />
              <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                Used by filters that inherit the default webhook destination.
              </p>
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

      {/* Auth Configuration */}
      <div className="rounded-xl border dark:border-gray-800 border-gray-200 dark:bg-gray-900 bg-white shadow-sm p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Authentication</h3>
          {!showAuthModeChange && (
            <button
              onClick={() => {
                setSelectedAuthMode(authModeData?.authMode ?? 'none');
                setShowAuthModeChange(true);
              }}
              className="rounded-lg border dark:border-gray-700 border-gray-300 px-3 py-1.5 text-xs font-medium dark:text-gray-400 text-gray-600 dark:hover:bg-gray-800 hover:bg-gray-100"
            >
              Change
            </button>
          )}
        </div>

        {!showAuthModeChange ? (
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between rounded-lg dark:bg-gray-800/50 bg-gray-50 border dark:border-transparent border-gray-200 px-4 py-3">
              <span className="text-sm dark:text-gray-400 text-gray-600">Auth Mode</span>
              <span className="rounded dark:bg-gray-700 bg-gray-200 px-2 py-0.5 text-sm font-medium dark:text-gray-300 text-gray-700 uppercase">
                {authModeData?.authMode ?? session?.mode ?? 'unknown'}
              </span>
            </div>
            {session?.user && (
              <div className="flex items-center justify-between rounded-lg dark:bg-gray-800/50 bg-gray-50 border dark:border-transparent border-gray-200 px-4 py-3">
                <span className="text-sm dark:text-gray-400 text-gray-600">Logged in as</span>
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {session.user.displayName || session.user.username}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Select a new authentication mode:
            </p>

            <div className="space-y-2">
              {(['none', 'basic', 'forms'] as const).map((mode) => (
                <label
                  key={mode}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                    selectedAuthMode === mode
                      ? 'border-blue-500 dark:bg-blue-500/10 bg-blue-50'
                      : 'border-gray-300 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900/60 dark:hover:bg-gray-800/50'
                  }`}
                >
                  <input
                    type="radio"
                    name="authMode"
                    value={mode}
                    checked={selectedAuthMode === mode}
                    onChange={() => setSelectedAuthMode(mode)}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-medium dark:text-gray-100 text-gray-900 capitalize">
                      {mode === 'none'
                        ? 'No Authentication'
                        : mode === 'forms'
                          ? 'Forms (Login Page)'
                          : 'Basic (Browser Prompt)'}
                    </div>
                    <div className="text-xs dark:text-gray-500 text-gray-600">
                      {mode === 'none' && '⚠️ Anyone can access Filtarr'}
                      {mode === 'basic' && 'HTTP Basic auth (browser login prompt)'}
                      {mode === 'forms' && 'Username/password login form'}
                    </div>
                  </div>
                </label>
              ))}
            </div>

            {/* Show credential fields if switching to auth mode without existing users */}
            {selectedAuthMode !== 'none' && !authModeData?.hasAdminUser && (
              <div className="space-y-3 rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800/50 bg-gray-50 p-4">
                <p className="text-sm text-yellow-600 dark:text-yellow-400">
                  Create admin account:
                </p>
                <div>
                  <label className="block text-xs font-medium dark:text-gray-400 text-gray-700">
                    Username
                  </label>
                  <input
                    type="text"
                    value={authUsername}
                    onChange={(e) => setAuthUsername(e.target.value)}
                    className="mt-1 block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 text-sm dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium dark:text-gray-400 text-gray-700">
                    Password
                  </label>
                  <input
                    type="password"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    placeholder="Min 8 characters"
                    className="mt-1 block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 text-sm dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>
            )}

            {/* Confirmation dialog */}
            {confirmAuthChange ? (
              <div className="rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-4">
                <p className="mb-3 text-sm text-yellow-400">
                  ⚠️ Are you sure you want to change authentication mode?
                  {selectedAuthMode === 'forms' && ' You will need to log in again.'}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleAuthModeSubmit}
                    disabled={changeAuthModeMutation.isPending}
                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {changeAuthModeMutation.isPending ? 'Changing...' : 'Confirm Change'}
                  </button>
                  <button
                    onClick={() => setConfirmAuthChange(false)}
                    className="rounded-lg border dark:border-gray-700 border-gray-300 px-4 py-2 text-sm font-medium dark:text-gray-400 text-gray-700 dark:hover:bg-gray-800 hover:bg-gray-100"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmAuthChange(true)}
                  disabled={selectedAuthMode === authModeData?.authMode}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Save Changes
                </button>
                <button
                  onClick={() => setShowAuthModeChange(false)}
                  className="rounded-lg border dark:border-gray-700 border-gray-300 px-4 py-2 text-sm font-medium dark:text-gray-400 text-gray-700 dark:hover:bg-gray-800 hover:bg-gray-100"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* API Keys */}
      <div className="rounded-xl border dark:border-gray-800 border-gray-200 dark:bg-gray-900 bg-white shadow-sm p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">API Keys</h3>
        <p className="mt-1 text-sm dark:text-gray-500 text-gray-600">
          Manage API keys for programmatic access to Filtarr.
        </p>

        {/* New Key Display */}
        {newKey && (
          <div className="mt-4 rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-4">
            <p className="mb-2 text-sm font-medium text-yellow-400">
              ⚠️ Save this API key — it will not be shown again!
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={newKey}
                className="block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 font-mono text-sm dark:text-gray-100 text-gray-900"
              />
              <button
                onClick={() => copyKey(newKey)}
                className="rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 dark:text-gray-400 text-gray-600 dark:hover:bg-gray-700 hover:bg-gray-100"
              >
                {copied ? '✓' : '📋'}
              </button>
            </div>
            <button
              onClick={() => setNewKey(null)}
              className="mt-2 text-sm text-gray-500 hover:text-gray-400"
            >
              I've saved this key
            </button>
          </div>
        )}

        {/* API Keys List */}
        <div className="mt-4 space-y-3">
          {loadingKeys ? (
            <p className="text-sm text-gray-500">Loading API keys...</p>
          ) : apiKeys && apiKeys.length > 0 ? (
            apiKeys.map((key) => (
              <div
                key={key.id}
                className="flex items-center justify-between rounded-lg dark:bg-gray-800/50 bg-gray-50 border dark:border-transparent border-gray-200 px-4 py-3"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 dark:text-gray-100">{key.name}</span>
                    <span className="font-mono text-sm dark:text-gray-500 text-gray-600">
                      {key.maskedKey}
                    </span>
                  </div>
                  <div className="mt-1 text-xs dark:text-gray-500 text-gray-600">
                    Created: {new Date(key.createdAt).toLocaleDateString()}
                    {key.lastUsedAt &&
                      ` • Last used: ${new Date(key.lastUsedAt).toLocaleDateString()}`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {confirmRotate === key.id ? (
                    <>
                      <span className="text-xs text-yellow-400">Invalidate old key?</span>
                      <button
                        onClick={() => rotateMutation.mutate(key.id)}
                        disabled={rotateMutation.isPending}
                        className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        {rotateMutation.isPending ? 'Rotating...' : 'Confirm'}
                      </button>
                      <button
                        onClick={() => setConfirmRotate(null)}
                        className="rounded-lg border dark:border-gray-700 border-gray-300 px-3 py-1.5 text-xs font-medium dark:text-gray-400 text-gray-700 dark:hover:bg-gray-800 hover:bg-gray-100"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmRotate(key.id)}
                      className="rounded-lg border dark:border-gray-700 border-gray-300 px-3 py-1.5 text-xs font-medium dark:text-gray-400 text-gray-700 dark:hover:bg-gray-800 hover:bg-gray-100"
                    >
                      Rotate
                    </button>
                  )}
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-gray-500">No API keys configured.</p>
          )}
        </div>
      </div>

      {/* General Settings */}
      <div className="rounded-xl border dark:border-gray-800 border-gray-200 dark:bg-gray-900 bg-white shadow-sm p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          General configuration
        </h3>

        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium dark:text-gray-400 text-gray-700">
              Instance Validation Interval (Minutes)
            </label>
            <p className="mb-2 text-xs dark:text-gray-500 text-gray-600">
              How often Filtarr will automatically test all enabled instances in the background.
            </p>
            <input
              type="number"
              min="1"
              value={validationInterval}
              onChange={(e) => setValidationInterval(e.target.value)}
              className="mt-1 block w-full max-w-sm rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="pt-2">
            <button
              onClick={handleSaveGeneralSettings}
              disabled={
                updateAppSettingsMutation.isPending ||
                appSettings?.validationIntervalMinutes.toString() === validationInterval
              }
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {updateAppSettingsMutation.isPending ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
