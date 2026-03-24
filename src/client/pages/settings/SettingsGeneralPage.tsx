import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../components/Toast';
import { api } from '../../lib/api';
import type { AppSettingsResponse } from './types';

export default function SettingsGeneralPage() {
  const queryClient = useQueryClient();
  const [validationInterval, setValidationInterval] = useState('15');

  const { data: appSettings } = useQuery({
    queryKey: ['settings', 'app'],
    queryFn: () => api.get<AppSettingsResponse>('/settings/app'),
  });

  useEffect(() => {
    if (appSettings) {
      setValidationInterval(appSettings.validationIntervalMinutes.toString());
    }
  }, [appSettings]);

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
    const value = Number.parseInt(validationInterval, 10);
    if (isNaN(value) || value < 1) {
      toast('error', 'Validation interval must be at least 1 minute');
      return;
    }

    updateAppSettingsMutation.mutate({ validationIntervalMinutes: value });
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        General configuration
      </h3>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
        Control background validation timing and other instance-wide defaults.
      </p>

      <div className="mt-4 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-400">
            Instance Validation Interval (Minutes)
          </label>
          <p className="mb-2 text-xs text-gray-600 dark:text-gray-500">
            How often Filtarr will automatically test all enabled instances in the background.
          </p>
          <input
            type="number"
            min="1"
            value={validationInterval}
            onChange={(e) => setValidationInterval(e.target.value)}
            className="mt-1 block w-full max-w-sm rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
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
  );
}