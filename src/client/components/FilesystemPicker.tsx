import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Modal } from './Modal';
import { Button, Field, Input, buttonStyles, cn } from './ui';

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
    <Modal title="Browse file system" isOpen={true} onClose={onClose} size="sm">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-1 overflow-x-auto rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:border-gray-800 dark:bg-gray-800/50 dark:text-gray-300">
          <button onClick={() => navigate('/')} className={buttonStyles({ variant: 'ghost', size: 'sm' })}>
            /
          </button>
          {parts.map((part, i) => {
            const fullPath = '/' + parts.slice(0, i + 1).join('/');
            return (
              <span key={fullPath} className="flex items-center gap-1">
                <span className="opacity-40">/</span>
                <button
                  onClick={() => navigate(fullPath)}
                  className={buttonStyles({ variant: 'ghost', size: 'sm' })}
                >
                  {part}
                </button>
              </span>
            );
          })}
        </div>

        <div className="max-h-[50vh] space-y-1 overflow-y-auto rounded-2xl border border-gray-200 bg-gray-50 p-2 dark:border-gray-800 dark:bg-gray-800/50">
          {isLoading ? <div className="py-8 text-center text-sm text-gray-500">Loading…</div> : null}
          {error ? (
            <div className="py-8 text-center text-sm text-red-500">
              {error instanceof Error ? error.message : 'Cannot read directory'}
            </div>
          ) : null}
          {!isLoading && !error ? (
            <>
              {data?.parent ? (
                <button
                  onClick={() => data.parent && navigate(data.parent)}
                  className={buttonStyles({
                    variant: 'ghost',
                    className: 'w-full justify-start rounded-xl px-3 py-2 text-left',
                  })}
                >
                  <span aria-hidden="true">↑</span>
                  <span>..</span>
                </button>
              ) : null}
              {data?.entries.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-500">No subdirectories here</p>
              ) : null}
              {data?.entries.map((entry) => (
                <button
                  key={entry.path}
                  onClick={() => navigate(entry.path)}
                  className={cn(
                    buttonStyles({
                      variant: 'ghost',
                      className: 'w-full justify-start rounded-xl px-3 py-2 text-left',
                    }),
                    pending === entry.path
                      ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                      : '',
                  )}
                >
                  <span aria-hidden="true">📁</span>
                  <span className="truncate">{entry.name}</span>
                </button>
              ))}
            </>
          ) : null}
        </div>

        <Field label="Selected Path" htmlFor="selected-path">
          <Input
            id="selected-path"
            value={pending}
            onChange={(e) => {
              setPending(e.target.value);
              setBrowsePath(e.target.value);
            }}
            className="font-mono"
          />
        </Field>

        <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSelect(pending);
              onClose();
            }}
            disabled={!pending}
          >
            Select Path
          </Button>
        </div>
      </div>
    </Modal>
  );
}
