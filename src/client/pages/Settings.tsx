import { useState } from 'react';
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

      {/* Auth Configuration */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Authentication</h3>
          {!showAuthModeChange && (
            <button
              onClick={() => {
                setSelectedAuthMode(authModeData?.authMode ?? 'none');
                setShowAuthModeChange(true);
              }}
              className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-400 hover:bg-gray-800"
            >
              Change
            </button>
          )}
        </div>

        {!showAuthModeChange ? (
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between rounded-lg bg-gray-800/50 px-4 py-3">
              <span className="text-sm text-gray-400">Auth Mode</span>
              <span className="rounded bg-gray-700 px-2 py-0.5 text-sm font-medium text-gray-300 uppercase">
                {authModeData?.authMode ?? session?.mode ?? 'unknown'}
              </span>
            </div>
            {session?.user && (
              <div className="flex items-center justify-between rounded-lg bg-gray-800/50 px-4 py-3">
                <span className="text-sm text-gray-400">Logged in as</span>
                <span className="text-sm font-medium">{session.user.displayName || session.user.username}</span>
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
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                    selectedAuthMode === mode ? 'border-blue-500 bg-blue-500/10' : 'border-gray-700'
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
                    <div className="font-medium text-gray-100 capitalize">{mode === 'none' ? 'No Authentication' : mode === 'forms' ? 'Forms (Login Page)' : 'Basic (Browser Prompt)'}</div>
                    <div className="text-xs text-gray-500">
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
              <div className="space-y-3 rounded-lg border border-gray-700 bg-gray-800/50 p-4">
                <p className="text-sm text-yellow-400">Create admin account:</p>
                <div>
                  <label className="block text-xs font-medium text-gray-400">Username</label>
                  <input
                    type="text"
                    value={authUsername}
                    onChange={(e) => setAuthUsername(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400">Password</label>
                  <input
                    type="password"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    placeholder="Min 8 characters"
                    className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
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
                    className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-400 hover:bg-gray-800"
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
                  className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-400 hover:bg-gray-800"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* API Keys */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
        <h3 className="text-lg font-semibold">API Keys</h3>
        <p className="mt-1 text-sm text-gray-500">
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
                className="block w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 font-mono text-sm text-gray-100"
              />
              <button
                onClick={() => copyKey(newKey)}
                className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-gray-400 hover:bg-gray-700"
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
              <div key={key.id} className="flex items-center justify-between rounded-lg bg-gray-800/50 px-4 py-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{key.name}</span>
                    <span className="font-mono text-sm text-gray-500">{key.maskedKey}</span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    Created: {new Date(key.createdAt).toLocaleDateString()}
                    {key.lastUsedAt && ` • Last used: ${new Date(key.lastUsedAt).toLocaleDateString()}`}
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
                        className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-400 hover:bg-gray-800"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmRotate(key.id)}
                      className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-400 hover:bg-gray-800"
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
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
        <h3 className="text-lg font-semibold">General</h3>
        <p className="mt-2 text-sm text-gray-500">
          Additional settings will be available as more features are added.
        </p>
      </div>
    </div>
  );
}

