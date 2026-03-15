import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../components/Toast';
import { api } from '../../lib/api';
import type {
  BackupCreateResponse,
  BackupImportResponse,
  BackupMutationResponse,
  BackupSettingsResponse,
} from './types';

function formatDateTime(value: string | null): string {
  if (!value) return 'Not available yet';

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SettingsBackupPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [directory, setDirectory] = useState('/config/backup');
  const [retentionCount, setRetentionCount] = useState('30');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const { data: backupSettings } = useQuery({
    queryKey: ['settings', 'backup'],
    queryFn: () => api.get<BackupSettingsResponse>('/settings/backup'),
  });

  useEffect(() => {
    if (!backupSettings || hydrated) return;

    setEnabled(backupSettings.enabled);
    setDirectory(backupSettings.directory);
    setRetentionCount(String(backupSettings.retentionCount));
    setHydrated(true);
  }, [backupSettings, hydrated]);

  const refreshBackupQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['settings', 'backup'] }),
      queryClient.invalidateQueries({ queryKey: ['settings', 'auth-mode'] }),
      queryClient.invalidateQueries({ queryKey: ['settings', 'notifications'] }),
      queryClient.invalidateQueries({ queryKey: ['settings', 'app'] }),
      queryClient.invalidateQueries({ queryKey: ['auth', 'session'] }),
    ]);
  };

  const saveBackupSettingsMutation = useMutation({
    mutationFn: (data: { enabled: boolean; directory: string; retentionCount: number }) =>
      api.put<BackupMutationResponse>('/settings/backup', data),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['settings', 'backup'] });
      setDirectory(data.directory);
      setRetentionCount(String(data.retentionCount));
      setEnabled(data.enabled);
      toast('success', data.message);
    },
    onError: (err: Error) => {
      toast('error', err.message);
    },
  });

  const createBackupMutation = useMutation({
    mutationFn: () => api.post<BackupCreateResponse>('/settings/backup/create'),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['settings', 'backup'] });
      toast('success', `${data.message}: ${data.backup.fileName}`);
    },
    onError: (err: Error) => {
      toast('error', err.message);
    },
  });

  const importBackupMutation = useMutation({
    mutationFn: async (file: File) => {
      const sql = await file.text();
      return api.post<BackupImportResponse>('/settings/backup/import', { sql });
    },
    onSuccess: async (data) => {
      await refreshBackupQueries();
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setSelectedFile(null);
      toast('success', data.message);
    },
    onError: (err: Error) => {
      toast('error', err.message);
    },
  });

  const normalizedDirectory = directory.trim();
  const normalizedRetentionCount = retentionCount.trim();
  const settingsChanged = useMemo(() => {
    if (!backupSettings) return false;

    return (
      backupSettings.enabled !== enabled ||
      backupSettings.directory !== (normalizedDirectory || '/config/backup') ||
      String(backupSettings.retentionCount) !== normalizedRetentionCount
    );
  }, [backupSettings, enabled, normalizedDirectory, normalizedRetentionCount]);

  const handleSave = () => {
    const parsedRetentionCount = Number.parseInt(normalizedRetentionCount, 10);
    if (!Number.isInteger(parsedRetentionCount) || parsedRetentionCount < 1) {
      toast('error', 'Retention count must be a positive whole number');
      return;
    }

    saveBackupSettingsMutation.mutate({
      enabled,
      directory: normalizedDirectory || '/config/backup',
      retentionCount: parsedRetentionCount,
    });
  };

  const handleImport = () => {
    if (!selectedFile) {
      toast('error', 'Choose a .sql backup file to import');
      return;
    }

    importBackupMutation.mutate(selectedFile);
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Backup & Restore</h3>
      <p className="mt-1 max-w-3xl text-sm text-gray-600 dark:text-gray-400">
        Create redacted SQL backups of the current SQLite configuration database, keep them on a
        daily schedule, and import them later without restoring live secrets.
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-800/40">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Automation</h4>
          <div className="mt-4 space-y-4">
            <label htmlFor="backup-enabled" className="flex items-start gap-3">
              <input
                id="backup-enabled"
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-gray-300 bg-white text-blue-600 dark:border-gray-700 dark:bg-gray-950"
              />
              <span className="block">
                <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">
                  Enable automated daily backups
                </span>
                <span className="block text-xs text-gray-600 dark:text-gray-400">
                  When enabled, Filtarr writes one redacted SQL backup per day by default.
                </span>
              </span>
            </label>

            <div>
              <label htmlFor="backup-directory" className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                Backup directory
              </label>
              <input
                id="backup-directory"
                type="text"
                value={directory}
                onChange={(event) => setDirectory(event.target.value)}
                placeholder="/config/backup"
                className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
              />
            </div>

            <div>
              <label htmlFor="backup-retention-count" className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                Retention count
              </label>
              <input
                id="backup-retention-count"
                type="number"
                min="1"
                value={retentionCount}
                onChange={(event) => setRetentionCount(event.target.value)}
                className="mt-1 block w-full max-w-xs rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
              />
              <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                Default retention is 30 files. Older backups are pruned after a new backup is
                created.
              </p>
            </div>

            <div className="grid gap-3 text-xs text-gray-600 dark:text-gray-400 sm:grid-cols-2">
              <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900/60">
                <div className="font-medium text-gray-700 dark:text-gray-200">Last backup</div>
                <div>{formatDateTime(backupSettings?.lastBackupAt ?? null)}</div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900/60">
                <div className="font-medium text-gray-700 dark:text-gray-200">Next scheduled backup</div>
                <div>{formatDateTime(backupSettings?.nextBackupAt ?? null)}</div>
              </div>
            </div>

            {backupSettings?.lastError && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-500/10 dark:text-amber-200">
                Last backup error: {backupSettings.lastError}
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleSave}
                disabled={saveBackupSettingsMutation.isPending || !backupSettings || !settingsChanged}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saveBackupSettingsMutation.isPending ? 'Saving...' : 'Save Backup Settings'}
              </button>
              <button
                type="button"
                onClick={() => createBackupMutation.mutate()}
                disabled={createBackupMutation.isPending}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                {createBackupMutation.isPending ? 'Creating Backup...' : 'Create Backup Now'}
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-800/40">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Import backup</h4>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            Importing replaces the saved configuration database with the selected redacted SQL
            backup. Secrets stay blank and must be entered again afterward.
          </p>

          <div className="mt-4 space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".sql,text/plain,application/sql"
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              className="block w-full text-sm text-gray-700 file:mr-4 file:rounded-lg file:border-0 file:bg-gray-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-gray-700 dark:text-gray-300 dark:file:bg-gray-100 dark:file:text-gray-900"
            />
            <div className="text-xs text-gray-600 dark:text-gray-400">
              {selectedFile ? `Selected file: ${selectedFile.name}` : 'Choose a generated .sql backup file to import.'}
            </div>
            <button
              type="button"
              onClick={handleImport}
              disabled={importBackupMutation.isPending}
              className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-500/10"
            >
              {importBackupMutation.isPending ? 'Importing Backup...' : 'Import Backup'}
            </button>
          </div>

          <div className="mt-6">
            <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-300">
              Redaction behavior
            </h5>
            <ul className="mt-2 space-y-2 text-xs text-gray-600 dark:text-gray-400">
              {(backupSettings?.redactionNotes ?? []).map((note) => (
                <li key={note} className="rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900/60">
                  {note}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-800/40">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Recent backups</h4>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
              Backups are stored on disk in the configured directory and can be imported from this
              page later.
            </p>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {backupSettings?.backups.length ?? 0} file(s)
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {(backupSettings?.backups.length ?? 0) === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-400">
              No backups have been created yet.
            </div>
          ) : (
            backupSettings?.backups.map((backup) => (
              <div
                key={backup.filePath}
                className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm dark:border-gray-700 dark:bg-gray-900/60"
              >
                <div className="font-medium text-gray-900 dark:text-gray-100">{backup.fileName}</div>
                <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                  {formatDateTime(backup.createdAt)} • {formatBytes(backup.sizeBytes)}
                </div>
                <div className="mt-1 break-all text-xs text-gray-500 dark:text-gray-500">
                  {backup.filePath}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
