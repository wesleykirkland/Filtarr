import { useState } from 'react';
import {
  useInstances,
  useCreateInstance,
  useUpdateInstance,
  useDeleteInstance,
  useTestInstance,
  useTestUnsavedInstance,
  type Instance,
  type CreateInstanceInput,
} from '../hooks/useInstances';
import { Modal } from '../components/Modal';
import { useTheme } from '../contexts/ThemeContext';
import { ConfirmModal } from '../components/ConfirmModal';

const ARR_TYPES = ['sonarr', 'radarr', 'lidarr'] as const;

type TestStatus = 'idle' | 'success' | 'error';

function getTestButtonLabel(isPending: boolean, status: TestStatus): string {
  if (isPending) return 'Testing...';
  if (status === 'error') return 'Test Failed';
  if (status === 'success') return 'Test Passed';
  return 'Test Connection';
}

function getTestButtonColor(status: TestStatus): string {
  if (status === 'error') return 'bg-red-600 hover:bg-red-700';
  if (status === 'success') return 'bg-green-600 hover:bg-green-700';
  return 'bg-gray-700 hover:bg-gray-600';
}

function InstanceForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: Instance;
  onSubmit: (data: CreateInstanceInput) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState(initial?.type ?? 'sonarr');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [apiKey, setApiKey] = useState('');
  const [timeout, setTimeout_] = useState(initial?.timeout?.toString() ?? '30');
  const [skipSslVerify, setSkipSslVerify] = useState(initial?.skipSslVerify ?? false);
  const [remotePath, setRemotePath] = useState(initial?.remotePath ?? '');
  const [localPath, setLocalPath] = useState(initial?.localPath ?? '');
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testError, setTestError] = useState<string | null>(null);

  const testUnsavedMutation = useTestUnsavedInstance();

  const resetTestState = () => {
    setTestStatus('idle');
    setTestError(null);
  };

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUrl(e.target.value);
    resetTestState();
  };

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setApiKey(e.target.value);
    resetTestState();
  };

  const handleSkipSslVerifyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSkipSslVerify(e.target.checked);
    resetTestState();
  };

  const applyTestResult = (success: boolean, errorMessage?: string) => {
    setTestStatus(success ? 'success' : 'error');
    setTestError(success ? null : (errorMessage || 'Connection failed'));
  };

  const handleTestConnection = (e: React.MouseEvent) => {
    e.preventDefault();
    testUnsavedMutation.mutate(
      {
        name: name || 'Test',
        type,
        url,
        apiKey: apiKey || (initial ? initial.api_key_masked : ''),
        timeout: Number.parseInt(timeout, 10) || undefined,
        skipSslVerify,
        remotePath: remotePath || null,
        localPath: localPath || null,
      },
      {
        onSuccess: (data: { success: boolean; error?: string }) => {
          applyTestResult(data.success, data.error);
        },
        onError: (error: Error) => {
          applyTestResult(false, error.message);
        },
      },
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name,
      type,
      url,
      apiKey: apiKey || (initial ? '' : apiKey), // empty = don't update
      timeout: Number.parseInt(timeout, 10) || undefined,
      skipSslVerify,
      remotePath: remotePath || null,
      localPath: localPath || null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="instance-name" className="block text-sm font-medium dark:text-gray-400 text-gray-700">Name</label>
          <input
            id="instance-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="mt-1 block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="instance-type" className="block text-sm font-medium dark:text-gray-400 text-gray-700">Type</label>
          {initial ? (
            <div className="mt-1 flex items-center gap-2">
              <span className="inline-flex items-center rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-gray-100 px-3 py-2 text-sm font-medium dark:text-gray-300 text-gray-700 capitalize">
                {initial.type}
              </span>
              <span className="text-xs dark:text-gray-500 text-gray-500">
                Cannot be changed after creation
              </span>
            </div>
          ) : (
            <select
              id="instance-type"
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                resetTestState();
              }}
              className="mt-1 block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none"
            >
              {ARR_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
          )}
        </div>
        <div>
          <label htmlFor="instance-url" className="block text-sm font-medium dark:text-gray-400 text-gray-700">URL</label>
          <input
            id="instance-url"
            value={url}
            onChange={handleUrlChange}
            required
            placeholder="http://localhost:8989"
            className="mt-1 block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="instance-api-key" className="block text-sm font-medium dark:text-gray-400 text-gray-700">
            API Key {initial && '(leave blank to keep, but must re-enter to test)'}
          </label>
          <input
            id="instance-api-key"
            value={apiKey}
            onChange={handleApiKeyChange}
            required={!initial}
            placeholder={initial ? '••••••••' : 'API Key'}
            className="mt-1 block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="instance-timeout" className="block text-sm font-medium dark:text-gray-400 text-gray-700">
            Timeout (seconds)
          </label>
          <input
            id="instance-timeout"
            type="number"
            value={timeout}
            onChange={(e) => {
              setTimeout_(e.target.value);
              resetTestState();
            }}
            min="1"
            className="mt-1 block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div className="col-span-2 flex items-center gap-2 pt-2">
          <input
            type="checkbox"
            id="skipSslVerify"
            checked={skipSslVerify}
            onChange={handleSkipSslVerifyChange}
            className="h-4 w-4 rounded dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white text-blue-600 focus:ring-blue-500 focus:ring-offset-gray-900"
          />
          <label
            htmlFor="skipSslVerify"
            className="text-sm font-medium dark:text-gray-400 text-gray-600"
          >
            Disable SSL verification (allows self-signed certificates, use with caution)
          </label>
        </div>

        <div className="col-span-2 border-t dark:border-gray-800 border-gray-100 pt-4">
          <h4 className="text-sm font-semibold dark:text-gray-300 text-gray-800 mb-3">
            Path Mapping (Optional)
          </h4>
          <p className="text-xs dark:text-gray-500 text-gray-500 mb-4">
            If Filtarr is running in a different environment (e.g. separate Docker containers), use
            these fields to translate paths reported by this Arr instance to local paths accessible
            by Filtarr.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="instance-remote-path" className="block text-sm font-medium dark:text-gray-400 text-gray-700">
                Remote Path (Arr's view)
              </label>
              <input
                id="instance-remote-path"
                value={remotePath}
                onChange={(e) => setRemotePath(e.target.value)}
                placeholder="/downloads"
                className="mt-1 block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none font-mono text-sm"
              />
            </div>
            <div>
              <label htmlFor="instance-local-path" className="block text-sm font-medium dark:text-gray-400 text-gray-700">
                Local Path (Filtarr's view)
              </label>
              <input
                id="instance-local-path"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                placeholder="/mnt/downloads"
                className="mt-1 block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none font-mono text-sm"
              />
            </div>
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleTestConnection}
          disabled={testUnsavedMutation.isPending || !url || (!apiKey && !initial)}
          className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 transition-colors ${getTestButtonColor(testStatus)}`}
        >
          {getTestButtonLabel(testUnsavedMutation.isPending, testStatus)}
        </button>
        <button
          type="submit"
          disabled={testStatus !== 'success'}
          title={testStatus === 'success' ? '' : 'Must successfully test connection before saving'}
          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed hidden sm:block"
        >
          {initial ? 'Update Connection' : 'Create Connection'}
        </button>
        {/* Mobile version of create button to keep gap nice */}
        <button
          type="submit"
          disabled={testStatus !== 'success'}
          title={testStatus === 'success' ? '' : 'Must successfully test connection before saving'}
          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed sm:hidden"
        >
          {initial ? 'Update' : 'Create'}
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border dark:border-gray-700 border-gray-300 px-4 py-2 text-sm font-medium dark:text-gray-400 text-gray-700 dark:hover:bg-gray-800 hover:bg-gray-100"
        >
          Cancel
        </button>
      </div>
      {testError && (
        <p className="text-sm font-medium text-red-600 dark:text-red-400">{testError}</p>
      )}
    </form>
  );
}

function InstanceCard({
  instance: inst,
  darkMode,
  onTest,
  isTestPending,
  onEdit,
  onDelete,
}: Readonly<{
  instance: Instance;
  darkMode: boolean;
  onTest: () => void;
  isTestPending: boolean;
  onEdit: () => void;
  onDelete: () => void;
}>) {
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border p-5 transition-all hover:shadow-xl ${darkMode
        ? 'bg-gray-900/40 border-gray-800 hover:border-gray-700/50'
        : 'bg-white border-gray-200'
        }`}
    >
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-600/50 via-green-600/50 to-blue-600/50 opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="mt-1 flex-shrink-0">
            <span
              className={`flex h-3 w-3 rounded-full ${inst.enabled ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-gray-400 dark:bg-gray-600'}`}
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-bold dark:text-gray-100 text-gray-900">{inst.name}</p>
              <span className="rounded dark:bg-gray-800 bg-gray-100 px-2 py-0.5 text-[10px] font-bold dark:text-gray-400 text-gray-500 uppercase tracking-wider border dark:border-gray-700 border-gray-200">
                {inst.type}
              </span>
            </div>
            <p className="mt-0.5 text-sm dark:text-gray-500 text-gray-600 font-medium">
              {inst.url}
            </p>
            {inst.skipSslVerify && (
              <span className="mt-1 inline-flex items-center rounded-full bg-yellow-500/10 px-2 py-0.5 text-[10px] font-semibold text-yellow-600 dark:text-yellow-500 border border-yellow-500/20 lowercase">
                insecure ssl
              </span>
            )}
            {(inst.remotePath || inst.localPath) && (
              <p className="mt-2 flex items-center gap-2 text-xs font-medium dark:text-gray-400 text-gray-500">
                <span className="rounded bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 font-mono">
                  {inst.remotePath || 'None'}
                </span>
                <span className="opacity-40">-&gt;</span>
                <span className="rounded bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 font-mono">
                  {inst.localPath || 'None'}
                </span>
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={onTest}
            disabled={isTestPending}
            className="rounded-lg border dark:border-gray-700 border-gray-300 px-3 py-1.5 text-xs font-medium dark:text-gray-400 text-gray-700 dark:hover:bg-gray-800 hover:bg-gray-100 disabled:opacity-50"
          >
            {isTestPending ? 'Testing...' : 'Test'}
          </button>
          <button
            onClick={onEdit}
            className="rounded-lg border dark:border-gray-700 border-gray-300 px-3 py-1.5 text-xs font-medium dark:text-gray-400 text-gray-700 dark:hover:bg-gray-800 hover:bg-gray-100"
          >
            Edit
          </button>
          <button
            onClick={onDelete}
            className="rounded-lg border dark:border-red-900 border-red-200 px-3 py-1.5 text-xs font-medium dark:text-red-400 text-red-600 dark:hover:bg-red-900/30 hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Instances() {
  const { data: instances, isLoading } = useInstances();
  const { darkMode } = useTheme();
  const createMutation = useCreateInstance();
  const updateMutation = useUpdateInstance();
  const deleteMutation = useDeleteInstance();
  const testMutation = useTestInstance();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Instance | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  if (isLoading)
    return <div className="dark:text-gray-400 text-gray-500">Loading instances...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold dark:text-gray-100 text-gray-900">Instances</h2>
        {!showForm && !editing && (
          <button
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            + Add Instance
          </button>
        )}
      </div>

      <Modal
        title={editing ? 'Edit Instance' : 'Add Instance'}
        isOpen={showForm || editing !== null}
        onClose={() => {
          setShowForm(false);
          setEditing(null);
        }}
      >
        {(showForm || editing !== null) && (
          <InstanceForm
            initial={editing ?? undefined}
            onSubmit={(data) => {
              if (editing) {
                const payload: Record<string, unknown> = { id: editing.id, ...data };
                updateMutation.mutate(payload as Parameters<typeof updateMutation.mutate>[0], {
                  onSuccess: () => setEditing(null),
                });
              } else {
                createMutation.mutate(data, { onSuccess: () => setShowForm(false) });
              }
            }}
            onCancel={() => {
              setShowForm(false);
              setEditing(null);
            }}
          />
        )}
      </Modal>

      {instances && instances.length > 0 ? (
        <div className="space-y-3">
          {instances.map((inst) => (
            <InstanceCard
              key={inst.id}
              instance={inst}
              darkMode={darkMode}
              onTest={() => testMutation.mutate(inst.id)}
              isTestPending={testMutation.isPending}
              onEdit={() => setEditing(inst)}
              onDelete={() => setDeletingId(inst.id)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border dark:border-gray-800 border-gray-200 dark:bg-gray-900 bg-white shadow-sm p-12 text-center">
          <p className="text-lg dark:text-gray-500 text-gray-600">No instances configured</p>
          <p className="mt-1 text-sm dark:text-gray-600 text-gray-500">
            Add your first Arr instance to get started.
          </p>
        </div>
      )}
      <ConfirmModal
        isOpen={deletingId !== null}
        title="Delete Instance"
        message={`Are you sure you want to delete the instance "${instances?.find(i => i.id === deletingId)?.name}"? This will also remove all associated filters.`}
        confirmLabel="Delete"
        isDestructive={true}
        onConfirm={() => deletingId && deleteMutation.mutate(deletingId)}
        onClose={() => setDeletingId(null)}
      />
    </div>
  );
}
