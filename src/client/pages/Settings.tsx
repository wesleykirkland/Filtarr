import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';
import { toast } from '../components/Toast';

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
  key: string;
  maskedKey: string;
  message: string;
  revokedKeyId: number;
}

export default function Settings() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [confirmRotate, setConfirmRotate] = useState<number | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: apiKeys, isLoading: loadingKeys } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => api.get<ApiKeyResponse[]>('/auth/api-keys'),
  });

  const rotateMutation = useMutation({
    mutationFn: (keyId: number) => api.post<RotateResponse>('/auth/api-keys/rotate', { keyId }),
    onSuccess: (data) => {
      setNewKey(data.key);
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

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Settings</h2>

      {/* Auth Configuration */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
        <h3 className="text-lg font-semibold">Authentication</h3>
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between rounded-lg bg-gray-800/50 px-4 py-3">
            <span className="text-sm text-gray-400">Auth Mode</span>
            <span className="rounded bg-gray-700 px-2 py-0.5 text-sm font-medium text-gray-300 uppercase">
              {session?.mode ?? 'unknown'}
            </span>
          </div>
          {session?.user && (
            <div className="flex items-center justify-between rounded-lg bg-gray-800/50 px-4 py-3">
              <span className="text-sm text-gray-400">Logged in as</span>
              <span className="text-sm font-medium">{session.user.displayName || session.user.username}</span>
            </div>
          )}
        </div>
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

