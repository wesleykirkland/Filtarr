import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

interface BrowseEntry {
  name: string;
  path: string;
  isDir: boolean;
}

interface BrowseResponse {
  current: string;
  parent: string | null;
  entries: BrowseEntry[];
}

interface FilesystemPickerProps {
  /** Currently selected path */
  value: string;
  /** Called when user confirms a selection */
  onSelect: (path: string) => void;
  /** Called when user cancels */
  onClose: () => void;
}

export function FilesystemPicker({ value, onSelect, onClose }: FilesystemPickerProps) {
  const [browsePath, setBrowsePath] = useState(value || '/');
  const [pending, setPending] = useState(value || '/');

  const { data, isLoading, error } = useQuery<BrowseResponse>({
    queryKey: ['browse', browsePath],
    queryFn: () => api.get(`/system/browse?path=${encodeURIComponent(browsePath)}`),
    retry: false,
  });

  const navigate = (p: string) => {
    setBrowsePath(p);
    setPending(p);
  };

  const parts = (data?.current || browsePath).split('/').filter(Boolean);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-lg rounded-2xl border dark:border-gray-700 border-gray-200 dark:bg-gray-900 bg-white shadow-2xl flex flex-col"
        style={{ maxHeight: '80vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b dark:border-gray-800 border-gray-200 px-5 py-4">
          <h3 className="font-semibold dark:text-gray-100 text-gray-900">Browse File System</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1 dark:text-gray-400 text-gray-500 dark:hover:bg-gray-800 hover:bg-gray-100"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 flex-wrap px-5 py-2 border-b dark:border-gray-800 border-gray-100 text-sm dark:text-gray-400 text-gray-600 overflow-x-auto">
          <button
            onClick={() => navigate('/')}
            className="dark:hover:text-gray-100 hover:text-gray-900"
          >
            /
          </button>
          {parts.map((part, i) => {
            const fullPath = '/' + parts.slice(0, i + 1).join('/');
            return (
              <span key={fullPath} className="flex items-center gap-1">
                <span className="opacity-40">/</span>
                <button
                  onClick={() => navigate(fullPath)}
                  className="dark:hover:text-gray-100 hover:text-gray-900"
                >
                  {part}
                </button>
              </span>
            );
          })}
        </div>

        {/* Directory listing */}
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {isLoading && (
            <div className="py-8 text-center dark:text-gray-500 text-gray-500 text-sm">
              Loading...
            </div>
          )}
          {error && (
            <div className="py-8 text-center text-red-400 text-sm">
              {error instanceof Error ? error.message : 'Cannot read directory'}
            </div>
          )}
          {!isLoading && !error && (
            <>
              {data?.parent && (
                <button
                  onClick={() => navigate(data.parent!)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm dark:hover:bg-gray-800 hover:bg-gray-100 dark:text-gray-400 text-gray-600"
                >
                  <span className="text-lg">↑</span>
                  <span>..</span>
                </button>
              )}
              {data?.entries.length === 0 && (
                <p className="py-6 text-center text-sm dark:text-gray-500 text-gray-500">
                  No subdirectories here
                </p>
              )}
              {data?.entries.map((entry) => (
                <button
                  key={entry.path}
                  onClick={() => navigate(entry.path)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-left transition-colors ${
                    pending === entry.path
                      ? 'dark:bg-blue-500/20 bg-blue-50 dark:text-blue-300 text-blue-700'
                      : 'dark:hover:bg-gray-800 hover:bg-gray-100 dark:text-gray-200 text-gray-800'
                  }`}
                >
                  <span className="text-lg flex-shrink-0">📁</span>
                  <span className="truncate">{entry.name}</span>
                </button>
              ))}
            </>
          )}
        </div>

        {/* Selected path + confirm */}
        <div className="border-t dark:border-gray-800 border-gray-200 px-5 py-4 space-y-3">
          <div>
            <label className="block text-xs font-medium dark:text-gray-400 text-gray-600 mb-1">
              Selected Path
            </label>
            <input
              value={pending}
              onChange={(e) => {
                setPending(e.target.value);
                setBrowsePath(e.target.value);
              }}
              className="block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 font-mono text-sm dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={onClose}
              className="rounded-lg border dark:border-gray-700 border-gray-300 px-4 py-2 text-sm font-medium dark:text-gray-400 text-gray-700 dark:hover:bg-gray-800 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                onSelect(pending);
                onClose();
              }}
              disabled={!pending}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Select Path
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
