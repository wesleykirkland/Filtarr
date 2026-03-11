import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import { api } from '../../lib/api';
import type {
  AuthMode,
  AuthModeResponse,
  ChangeAuthModeResponse,
  OidcSettingsResponse,
} from './types';

export default function SettingsAuthenticationPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showAuthModeChange, setShowAuthModeChange] = useState(false);
  const [selectedAuthMode, setSelectedAuthMode] = useState<AuthMode>('none');
  const [authUsername, setAuthUsername] = useState('admin');
  const [authPassword, setAuthPassword] = useState('');
  const [confirmAuthChange, setConfirmAuthChange] = useState(false);
  const [oidcIssuerUrl, setOidcIssuerUrl] = useState('');
  const [oidcClientId, setOidcClientId] = useState('');
  const [oidcClientSecret, setOidcClientSecret] = useState('');
  const [oidcCallbackUrl, setOidcCallbackUrl] = useState('');
  const [oidcScopes, setOidcScopes] = useState('openid, profile, email');

  const { data: authModeData } = useQuery({
    queryKey: ['settings', 'auth-mode'],
    queryFn: () => api.get<AuthModeResponse>('/settings/auth-mode'),
  });

  const changeAuthModeMutation = useMutation({
    mutationFn: (data: {
      authMode: AuthMode;
      username?: string;
      password?: string;
      oidc?: OidcSettingsResponse;
    }) => api.put<ChangeAuthModeResponse>('/settings/auth-mode', data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'auth-mode'] });
      queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
      toast('success', data.message);
      setShowAuthModeChange(false);
      setConfirmAuthChange(false);
      setAuthPassword('');

      if (data.authMode === 'forms' || data.authMode === 'oidc') {
        navigate('/login', { replace: true });
      }
    },
    onError: (err: Error) => {
      toast('error', err.message);
      setConfirmAuthChange(false);
    },
  });

  const openAuthModeChange = () => {
    setSelectedAuthMode(authModeData?.authMode ?? 'none');
    setOidcIssuerUrl(authModeData?.oidc.issuerUrl ?? '');
    setOidcClientId(authModeData?.oidc.clientId ?? '');
    setOidcClientSecret(authModeData?.oidc.clientSecret ?? '');
    setOidcCallbackUrl(authModeData?.oidc.callbackUrl ?? '');
    setOidcScopes(authModeData?.oidc.scopes.join(', ') ?? 'openid, profile, email');
    setShowAuthModeChange(true);
  };

  const handleAuthModeSubmit = () => {
    const normalizedOidc: OidcSettingsResponse = {
      issuerUrl: oidcIssuerUrl.trim(),
      clientId: oidcClientId.trim(),
      clientSecret: oidcClientSecret.trim(),
      callbackUrl: oidcCallbackUrl.trim(),
      scopes: oidcScopes
        .split(',')
        .map((scope) => scope.trim())
        .filter(Boolean),
    };

    if (selectedAuthMode === 'oidc') {
      if (
        !normalizedOidc.issuerUrl ||
        !normalizedOidc.clientId ||
        !normalizedOidc.clientSecret ||
        !normalizedOidc.callbackUrl ||
        normalizedOidc.scopes.length === 0
      ) {
        toast('error', 'OIDC requires issuer URL, client ID, client secret, callback URL, and scopes');
        return;
      }
    }

    const needsCredentials =
      (selectedAuthMode === 'basic' || selectedAuthMode === 'forms') && !authModeData?.hasAdminUser;
    changeAuthModeMutation.mutate({
      authMode: selectedAuthMode,
      username: needsCredentials ? authUsername : undefined,
      password: needsCredentials ? authPassword : undefined,
      oidc: selectedAuthMode === 'oidc' ? normalizedOidc : undefined,
    });
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Authentication</h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Configure local auth or OIDC directly from its own Settings page.
          </p>
        </div>

        {!showAuthModeChange && (
          <button
            onClick={openAuthModeChange}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            Change
          </button>
        )}
      </div>

      {!showAuthModeChange ? (
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-transparent dark:bg-gray-800/50">
            <span className="text-sm text-gray-600 dark:text-gray-400">Auth Mode</span>
            <span className="rounded bg-gray-200 px-2 py-0.5 text-sm font-medium uppercase text-gray-700 dark:bg-gray-700 dark:text-gray-300">
              {authModeData?.authMode ?? session?.mode ?? 'unknown'}
            </span>
          </div>

          {session?.user && (
            <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-transparent dark:bg-gray-800/50">
              <span className="text-sm text-gray-600 dark:text-gray-400">Logged in as</span>
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {session.user.displayName || session.user.username}
              </span>
            </div>
          )}

          {authModeData?.authMode === 'oidc' && (
            <>
              <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-transparent dark:bg-gray-800/50">
                <span className="text-sm text-gray-600 dark:text-gray-400">Issuer URL</span>
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {authModeData.oidc.issuerUrl || 'Not configured'}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-transparent dark:bg-gray-800/50">
                <span className="text-sm text-gray-600 dark:text-gray-400">Client ID</span>
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {authModeData.oidc.clientId || 'Not configured'}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-transparent dark:bg-gray-800/50">
                <span className="text-sm text-gray-600 dark:text-gray-400">Callback URL</span>
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {authModeData.oidc.callbackUrl || 'Not configured'}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-transparent dark:bg-gray-800/50">
                <span className="text-sm text-gray-600 dark:text-gray-400">Scopes</span>
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {authModeData.oidc.scopes.join(', ') || 'Not configured'}
                </span>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">Select a new authentication mode:</p>

          <div className="space-y-2">
            {(['none', 'basic', 'forms', 'oidc'] as const).map((mode) => (
              <label
                key={mode}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                  selectedAuthMode === mode
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10'
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
                  <div className="font-medium capitalize text-gray-900 dark:text-gray-100">
                    {mode === 'none'
                      ? 'No Authentication'
                      : mode === 'forms'
                        ? 'Forms (Login Page)'
                        : mode === 'oidc'
                          ? 'OIDC / OpenID Connect'
                          : 'Basic (Browser Prompt)'}
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-500">
                    {mode === 'none' && '⚠️ Anyone can access Filtarr'}
                    {mode === 'basic' && 'HTTP Basic auth (browser login prompt)'}
                    {mode === 'forms' && 'Username/password login form'}
                    {mode === 'oidc' && 'External identity provider sign-in via OpenID Connect'}
                  </div>
                </div>
              </label>
            ))}
          </div>

          {selectedAuthMode === 'oidc' && (
            <div className="space-y-4 rounded-lg border border-gray-300 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-400">
                  Issuer URL
                </label>
                <input
                  type="url"
                  value={oidcIssuerUrl}
                  onChange={(e) => setOidcIssuerUrl(e.target.value)}
                  placeholder="https://id.example.com/realms/filtarr"
                  className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-400">
                    Client ID
                  </label>
                  <input
                    type="text"
                    value={oidcClientId}
                    onChange={(e) => setOidcClientId(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-400">
                    Client Secret
                  </label>
                  <input
                    type="password"
                    value={oidcClientSecret}
                    onChange={(e) => setOidcClientSecret(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-400">
                  Callback URL
                </label>
                <input
                  type="url"
                  value={oidcCallbackUrl}
                  onChange={(e) => setOidcCallbackUrl(e.target.value)}
                  placeholder="http://localhost:9898/api/v1/auth/oidc/callback"
                  className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-400">
                  Scopes
                </label>
                <input
                  type="text"
                  value={oidcScopes}
                  onChange={(e) => setOidcScopes(e.target.value)}
                  placeholder="openid, profile, email"
                  className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                />
                <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                  Enter a comma-separated scope list that matches your identity provider.
                </p>
              </div>
            </div>
          )}

          {(selectedAuthMode === 'basic' || selectedAuthMode === 'forms') && !authModeData?.hasAdminUser && (
            <div className="space-y-3 rounded-lg border border-gray-300 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
              <p className="text-sm text-yellow-600 dark:text-yellow-400">Create admin account:</p>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-400">
                  Username
                </label>
                <input
                  type="text"
                  value={authUsername}
                  onChange={(e) => setAuthUsername(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-400">
                  Password
                </label>
                <input
                  type="password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="Min 8 characters"
                  className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                />
              </div>
            </div>
          )}

          {confirmAuthChange ? (
            <div className="rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-4">
              <p className="mb-3 text-sm text-yellow-400">
                ⚠️ Are you sure you want to change authentication mode?
                {(selectedAuthMode === 'forms' || selectedAuthMode === 'oidc') && ' You will need to log in again.'}
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
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
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
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}