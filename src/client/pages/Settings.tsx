import { useState, useEffect } from 'react';
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

interface Directory {
  id: number;
  path: string;
  recursive: boolean;
  enabled: boolean;
  createdAt: string;
}

export default function Settings() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmRotate, setConfirmRotate] = useState<number | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Directories state
  const [newDirPath, setNewDirPath] = useState('');
  const [newDirRecursive, setNewDirRecursive] = useState(true);
  const [editingDir, setEditingDir] = useState<Directory | null>(null);
  const [editDirPath, setEditDirPath] = useState('');
  const [editDirRecursive, setEditDirRecursive] = useState(true);

  // Auth mode change state
  const [showAuthModeChange, setShowAuthModeChange] = useState(false);
  const [selectedAuthMode, setSelectedAuthMode] = useState<AuthMode>('none');
  const [authUsername, setAuthUsername] = useState('admin');
  const [authPassword, setAuthPassword] = useState('');
  const [confirmAuthChange, setConfirmAuthChange] = useState(false);

  // Notifications state
  const [notifyGlobalEnabled, setNotifyGlobalEnabled] = useState(false);
  const [notifyGlobalType, setNotifyGlobalType] = useState<'webhook' | 'slack'>('webhook');
  const [notifyGlobalUrl, setNotifyGlobalUrl] = useState('');
  const [notifyGlobalSlackToken, setNotifyGlobalSlackToken] = useState('');
  const [notifyGlobalSlackChannel, setNotifyGlobalSlackChannel] = useState('');
  const [isNotificationsDirty, setIsNotificationsDirty] = useState(false);

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

  const [validationInterval, setValidationInterval] = useState('60');

  // Notifications queries
  const { data: notificationSettings } = useQuery({
    queryKey: ['settings', 'notifications'],
    queryFn: () => api.get<Record<string, string>>('/settings/notifications'),
  });

  // Sync notification state
  useEffect(() => {
    if (notificationSettings) {
      setNotifyGlobalEnabled(notificationSettings['notify_global_enabled'] === '1');
      setNotifyGlobalType((notificationSettings['notify_global_type'] as any) || 'webhook');
      setNotifyGlobalUrl(notificationSettings['notify_global_url'] || '');
      setNotifyGlobalSlackToken(notificationSettings['notify_global_slack_token'] || '');
      setNotifyGlobalSlackChannel(notificationSettings['notify_global_slack_channel'] || '');
    }
  }, [notificationSettings]);

  const updateNotificationsMutation = useMutation({
    mutationFn: (data: any) => api.put<{ success: boolean; message: string }>('/settings/notifications', data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'notifications'] });
      toast('success', data.message);
      setIsNotificationsDirty(false);
    },
    onError: (err: Error) => toast('error', err.message),
  });

  const testNotificationMutation = useMutation({
    mutationFn: () => api.post<{ success: boolean; message: string }>('/settings/notifications/test', {}),
    onSuccess: (data) => toast('success', data.message),
    onError: (err: Error) => toast('error', err.message),
  });

  const handleSaveNotifications = () => {
    updateNotificationsMutation.mutate({
      enabled: notifyGlobalEnabled,
      type: notifyGlobalType,
      url: notifyGlobalUrl,
      slackToken: notifyGlobalSlackToken,
      slackChannel: notifyGlobalSlackChannel,
    });
  };

  useQuery({
    queryKey: ['settings', 'app', 'sync'],
    queryFn: () => {
      if (appSettings) setValidationInterval(appSettings.validationIntervalMinutes.toString());
      return null;
    },
    enabled: !!appSettings && validationInterval === '60', // only fire if still default
  });

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

  const handleSaveGeneralSettings = () => {
    const val = parseInt(validationInterval, 10);
    if (isNaN(val) || val < 1) {
      toast('error', 'Validation interval must be at least 1 minute');
      return;
    }
    updateAppSettingsMutation.mutate({ validationIntervalMinutes: val });
  };

  // Directories queries
  const { data: directories } = useQuery<Directory[]>({
    queryKey: ['directories'],
    queryFn: () => api.get('/directories'),
  });

  const createDirMutation = useMutation({
    mutationFn: (body: { path: string; recursive: boolean }) => api.post('/directories', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['directories'] });
      setNewDirPath('');
      setNewDirRecursive(true);
      toast('success', 'Directory added');
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const updateDirMutation = useMutation({
    mutationFn: ({ id, ...body }: { id: number; path: string; recursive: boolean }) =>
      api.put(`/directories/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['directories'] });
      setEditingDir(null);
      toast('success', 'Directory updated');
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const toggleDirMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      api.put(`/directories/${id}`, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['directories'] }),
    onError: (e: Error) => toast('error', e.message),
  });

  const deleteDirMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/directories/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['directories'] });
      toast('success', 'Directory removed');
    },
    onError: (e: Error) => toast('error', e.message),
  });

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
      <h2 className="text-2xl font-bold">Settings</h2>

      {/* Watched Directories */}
      <div className="rounded-xl border dark:border-gray-800 border-gray-200 dark:bg-gray-900 bg-white shadow-sm p-6">
        <h3 className="text-lg font-semibold dark:text-gray-100 text-gray-900">
          Watched Directories
        </h3>
        <p className="mt-1 text-sm dark:text-gray-500 text-gray-600 max-w-xl">
          Map local file system paths that Filtarr should monitor. These should be the same paths
          your Arr instances write downloads to.
        </p>

        {/* Add directory form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!newDirPath.trim()) return;
            createDirMutation.mutate({ path: newDirPath.trim(), recursive: newDirRecursive });
          }}
          className="mt-4 flex flex-wrap items-end gap-3"
        >
          <div className="flex-1 min-w-48">
            <label className="block text-xs font-medium dark:text-gray-400 text-gray-700">
              Path
            </label>
            <input
              value={newDirPath}
              onChange={(e) => setNewDirPath(e.target.value)}
              placeholder="/downloads/complete"
              className="mt-1 block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none text-sm"
            />
          </div>
          <div className="flex items-center gap-2 pb-2">
            <input
              type="checkbox"
              id="newDirRecursive"
              checked={newDirRecursive}
              onChange={(e) => setNewDirRecursive(e.target.checked)}
              className="h-4 w-4 rounded dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white text-blue-600"
            />
            <label htmlFor="newDirRecursive" className="text-sm dark:text-gray-400 text-gray-600">
              Recursive
            </label>
          </div>
          <button
            type="submit"
            disabled={createDirMutation.isPending || !newDirPath.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {createDirMutation.isPending ? 'Adding...' : 'Add Directory'}
          </button>
        </form>

        {/* Directory list */}
        <div className="mt-4 space-y-2">
          {!directories || directories.length === 0 ? (
            <p className="text-sm dark:text-gray-500 text-gray-600 py-2">
              No directories configured. Add one above.
            </p>
          ) : (
            directories.map((dir) => (
              <div
                key={dir.id}
                className="rounded-lg border dark:border-gray-700 border-gray-200 dark:bg-gray-800/50 bg-gray-50 px-4 py-3"
              >
                {editingDir?.id === dir.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      updateDirMutation.mutate({
                        id: dir.id,
                        path: editDirPath,
                        recursive: editDirRecursive,
                      });
                    }}
                    className="flex flex-wrap items-center gap-3"
                  >
                    <input
                      value={editDirPath}
                      onChange={(e) => setEditDirPath(e.target.value)}
                      className="flex-1 min-w-40 rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-1.5 text-sm dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none"
                    />
                    <div className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        id={`editRec-${dir.id}`}
                        checked={editDirRecursive}
                        onChange={(e) => setEditDirRecursive(e.target.checked)}
                        className="h-4 w-4 rounded"
                      />
                      <label
                        htmlFor={`editRec-${dir.id}`}
                        className="text-xs dark:text-gray-400 text-gray-600"
                      >
                        Recursive
                      </label>
                    </div>
                    <button
                      type="submit"
                      className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingDir(null)}
                      className="rounded-lg border dark:border-gray-700 border-gray-300 px-3 py-1.5 text-xs font-medium dark:text-gray-400 text-gray-600 dark:hover:bg-gray-800 hover:bg-gray-100"
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <button
                        onClick={() =>
                          toggleDirMutation.mutate({ id: dir.id, enabled: !dir.enabled })
                        }
                        className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${dir.enabled ? 'bg-blue-600' : 'dark:bg-gray-700 bg-gray-300'}`}
                      >
                        <span
                          className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${dir.enabled ? 'translate-x-4' : 'translate-x-0'}`}
                        />
                      </button>
                      <div className="min-w-0">
                        <p className="font-mono text-sm dark:text-gray-100 text-gray-900 truncate">
                          {dir.path}
                        </p>
                        <p className="text-xs dark:text-gray-500 text-gray-600">
                          {dir.recursive ? 'Recursive' : 'Top-level only'}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={() => {
                          setEditingDir(dir);
                          setEditDirPath(dir.path);
                          setEditDirRecursive(dir.recursive);
                        }}
                        className="rounded-lg border dark:border-gray-700 border-gray-300 px-3 py-1.5 text-xs font-medium dark:text-gray-400 text-gray-700 dark:hover:bg-gray-800 hover:bg-gray-100"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Remove directory: ${dir.path}?`))
                            deleteDirMutation.mutate(dir.id);
                        }}
                        className="rounded-lg border dark:border-red-900 border-red-200 px-3 py-1.5 text-xs font-medium dark:text-red-400 text-red-600 dark:hover:bg-red-900/30 hover:bg-red-50"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Auth Configuration */}
      <div className="rounded-xl border dark:border-gray-800 border-gray-200 dark:bg-gray-900 bg-white shadow-sm p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Authentication</h3>
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
                <span className="text-sm font-medium">
                  {session.user.displayName || session.user.username}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-gray-400">Select a new authentication mode:</p>

            <div className="space-y-2">
              {(['none', 'basic', 'forms'] as const).map((mode) => (
                <label
                  key={mode}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${selectedAuthMode === mode
                    ? 'border-blue-500 dark:bg-blue-500/10 bg-blue-50'
                    : 'dark:border-gray-700 border-gray-300 dark:hover:bg-gray-800/50 hover:bg-gray-50'
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

      {/* Global Notifications */}
      <div className="rounded-xl border dark:border-gray-800 border-gray-200 dark:bg-gray-900 bg-white shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold dark:text-gray-100 text-gray-900">Notifications</h3>
            <p className="text-sm dark:text-gray-500 text-gray-600">
              Configure global notification settings that filters can inherit.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => testNotificationMutation.mutate()}
              disabled={testNotificationMutation.isPending || isNotificationsDirty || !notifyGlobalEnabled}
              title={isNotificationsDirty ? "Save changes before testing" : ""}
              className="rounded-lg border dark:border-gray-700 border-gray-300 px-3 py-1.5 text-xs font-medium dark:text-gray-400 text-gray-600 dark:hover:bg-gray-800 hover:bg-gray-100 disabled:opacity-50"
            >
              🚀 Test
            </button>
            <button
              onClick={() => {
                setNotifyGlobalEnabled(!notifyGlobalEnabled);
                setIsNotificationsDirty(true);
              }}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${notifyGlobalEnabled ? 'bg-blue-600' : 'dark:bg-gray-700 bg-gray-300'}`}
            >
              <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${notifyGlobalEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>

        {notifyGlobalEnabled && (
          <div className="space-y-4 pt-2 border-t dark:border-gray-800 border-gray-100 mt-4">
            <div>
              <label className="block text-xs font-medium dark:text-gray-400 text-gray-700 mb-2">Notification Type</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="notifyType"
                    checked={notifyGlobalType === 'webhook'}
                    onChange={() => { setNotifyGlobalType('webhook'); setIsNotificationsDirty(true); }}
                    className="h-4 w-4 text-blue-600"
                  />
                  <span className="text-sm dark:text-gray-300">Generic Webhook</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="notifyType"
                    checked={notifyGlobalType === 'slack'}
                    onChange={() => { setNotifyGlobalType('slack'); setIsNotificationsDirty(true); }}
                    className="h-4 w-4 text-blue-600"
                  />
                  <span className="text-sm dark:text-gray-300">Slack (Modern Flow)</span>
                </label>
              </div>
            </div>

            {notifyGlobalType === 'webhook' ? (
              <div>
                <label className="block text-xs font-medium dark:text-gray-400 text-gray-700">Webhook URL</label>
                <input
                  type="url"
                  value={notifyGlobalUrl}
                  onChange={(e) => { setNotifyGlobalUrl(e.target.value); setIsNotificationsDirty(true); }}
                  placeholder="https://hooks.slack.com/services/... or https://discord.com/api/webhooks/..."
                  className="mt-1 block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 text-sm dark:text-gray-100 focus:border-blue-500 focus:outline-none"
                />
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <p className="text-xs text-blue-400 bg-blue-500/10 p-3 rounded-lg border border-blue-500/20 mb-2">
                    Filtarr uses the modern Slack App flow. Create a Slack App in your workspace, enable <b>Incoming Webhooks</b>, or use a <b>Bot User OAuth Token</b> for more control.
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium dark:text-gray-400 text-gray-700">Bot User OAuth Token</label>
                  <input
                    type="password"
                    value={notifyGlobalSlackToken}
                    onChange={(e) => { setNotifyGlobalSlackToken(e.target.value); setIsNotificationsDirty(true); }}
                    placeholder="xoxb-..."
                    className="mt-1 block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 text-sm dark:text-gray-100 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium dark:text-gray-400 text-gray-700">Channel ID or Name</label>
                  <input
                    type="text"
                    value={notifyGlobalSlackChannel}
                    onChange={(e) => { setNotifyGlobalSlackChannel(e.target.value); setIsNotificationsDirty(true); }}
                    placeholder="#general or C1234567"
                    className="mt-1 block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 text-sm dark:text-gray-100 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>
            )}

            <div className="pt-2">
              <button
                onClick={handleSaveNotifications}
                disabled={updateNotificationsMutation.isPending || !isNotificationsDirty}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {updateNotificationsMutation.isPending ? 'Saving...' : 'Save Notification Settings'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* API Keys */}
      <div className="rounded-xl border dark:border-gray-800 border-gray-200 dark:bg-gray-900 bg-white shadow-sm p-6">
        <h3 className="text-lg font-semibold">API Keys</h3>
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
