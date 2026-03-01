import { useAuth } from '../hooks/useAuth';

export default function Settings() {
  const { session } = useAuth();

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

