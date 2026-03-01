import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useInstances } from '../hooks/useInstances';
import { useTheme } from '../contexts/ThemeContext';

interface HealthResponse {
  status: string;
  version: string;
}

export default function Dashboard() {
  const { darkMode } = useTheme();
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<HealthResponse>('/health'),
  });

  const { data: instances } = useInstances();

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold dark:text-gray-100 text-gray-900">Dashboard</h2>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* System Status */}
        <div
          className={`rounded-xl border p-6 shadow-sm transition-all ${
            darkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'
          }`}
        >
          <h3 className="text-sm font-medium dark:text-gray-400 text-gray-600">System Status</h3>
          <div className="mt-2 flex items-center gap-2">
            <span
              className={`h-3 w-3 rounded-full ${health?.status === 'ok' ? 'bg-green-500' : 'bg-red-500'}`}
            />
            <span className="text-lg font-semibold capitalize">{health?.status ?? 'Unknown'}</span>
          </div>
          {health?.version && (
            <p className="mt-1 text-sm dark:text-gray-500 text-gray-600">v{health.version}</p>
          )}
        </div>

        {/* Connected Instances */}
        <div
          className={`rounded-xl border p-6 shadow-sm transition-all ${
            darkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'
          }`}
        >
          <h3 className="text-sm font-medium dark:text-gray-400 text-gray-600">
            Connected Instances
          </h3>
          <p className="mt-2 text-3xl font-bold dark:text-gray-100 text-gray-900">
            {instances?.length ?? 0}
          </p>
          <p className="mt-1 text-sm dark:text-gray-500 text-gray-600">
            {instances?.filter((i) => i.enabled).length ?? 0} active
          </p>
        </div>

        {/* Quick Info */}
        <div
          className={`rounded-xl border p-6 shadow-sm transition-all ${
            darkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'
          }`}
        >
          <h3 className="text-sm font-medium dark:text-gray-400 text-gray-600">Filters Active</h3>
          <p className="mt-2 text-3xl font-bold dark:text-gray-100 text-gray-900">0</p>
          <p className="mt-1 text-sm dark:text-gray-500 text-gray-600">Coming in Wave 2</p>
        </div>
      </div>

      {/* Instance Health */}
      {instances && instances.length > 0 && (
        <div
          className={`rounded-xl border p-6 shadow-sm transition-all ${
            darkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'
          }`}
        >
          <h3 className="mb-4 text-lg font-semibold dark:text-gray-100 text-gray-900">
            Instance Health
          </h3>
          <div className="space-y-3">
            {instances.map((inst) => (
              <div
                key={inst.id}
                className="flex items-center justify-between rounded-lg dark:bg-gray-800/50 bg-gray-50 border dark:border-transparent border-gray-200 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${inst.enabled ? 'bg-green-500' : 'bg-gray-400 dark:bg-gray-600'}`}
                  />
                  <span className="font-medium dark:text-gray-100 text-gray-900">{inst.name}</span>
                  <span className="rounded dark:bg-gray-700 bg-gray-200 px-2 py-0.5 text-xs dark:text-gray-300 text-gray-700 uppercase">
                    {inst.type}
                  </span>
                </div>
                <span className="text-sm dark:text-gray-500 text-gray-600">{inst.url}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Activity placeholder */}
      <div
        className={`rounded-xl border p-6 shadow-sm transition-all ${
          darkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'
        }`}
      >
        <h3 className="mb-4 text-lg font-semibold dark:text-gray-100 text-gray-900">
          Recent Activity
        </h3>
        <p className="dark:text-gray-500 text-gray-600">No recent activity to display.</p>
      </div>
    </div>
  );
}
