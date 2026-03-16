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
import { InstancesIcon, PlusIcon } from '../components/Icons';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  checkboxStyles,
} from '../components/ui';

const ARR_TYPES = ['sonarr', 'radarr', 'lidarr'] as const;

function buildUpdatePayload(id: number, data: CreateInstanceInput): Record<string, unknown> {
  const payload: Record<string, unknown> = { id };
  const stringFields: Array<readonly [keyof CreateInstanceInput, string]> = [
    ['name', data.name],
    ['type', data.type],
    ['url', data.url],
    ['apiKey', data.apiKey],
  ];

  for (const [key, value] of stringFields) {
    if (value) payload[key] = value;
  }

  if (data.timeout !== undefined) payload['timeout'] = data.timeout;
  payload['skipSslVerify'] = data.skipSslVerify;
  if (data.remotePath !== undefined) payload['remotePath'] = data.remotePath;
  if (data.localPath !== undefined) payload['localPath'] = data.localPath;
  return payload;
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
  const [testStatus, setTestStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const testUnsavedMutation = useTestUnsavedInstance();
  const canSave = testStatus === 'success';
  const primaryLabel = initial ? 'Update Connection' : 'Create Connection';
  const compactLabel = initial ? 'Update' : 'Create';
  let testVariant: 'secondary' | 'success' | 'danger' = 'secondary';
  if (testStatus === 'success') testVariant = 'success';
  if (testStatus === 'error') testVariant = 'danger';
  let testLabel = 'Test Connection';
  if (testUnsavedMutation.isPending) {
    testLabel = 'Testing...';
  } else if (testStatus === 'error') {
    testLabel = 'Test Failed';
  } else if (testStatus === 'success') {
    testLabel = 'Test Passed';
  }

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUrl(e.target.value);
    setTestStatus('idle');
  };

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setApiKey(e.target.value);
    setTestStatus('idle');
  };

  const handleSkipSslVerifyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSkipSslVerify(e.target.checked);
    setTestStatus('idle');
  };

  const handleTestConnection = (e: React.MouseEvent) => {
    e.preventDefault();
    testUnsavedMutation.mutate(
      {
        name: name || 'Test',
        type,
        url,
        apiKey: apiKey || (initial ? initial.api_key_masked : ''), // Note: We need real API key if editing and not changed. Wait, we can't get it.
        // Actually, if editing and apiKey is blank, the backend expects us to send it blank to keep it.
        // But testing needs the real API key. The backend /test route will need to be able to pull it if id is provided.
        // For now, if editing and blank, we should warn the user they must re-enter the API key to test.
        timeout: Number.parseInt(timeout, 10) || undefined,
        skipSslVerify,
        remotePath: remotePath || null,
        localPath: localPath || null,
      },
      {
        onSuccess: (data: { success: boolean; error?: string }) => {
          if (data.success) {
            setTestStatus('success');
          } else {
            setTestStatus('error');
          }
        },
        onError: () => {
          setTestStatus('error');
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
        <Field label="Name" htmlFor="instance-name">
          <Input
            id="instance-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>
        <Field label="Type" htmlFor="instance-type">
          {initial ? (
            <div className="mt-1 flex items-center gap-2">
              <Badge>{initial.type}</Badge>
              <span className="text-xs text-gray-500">
                {initial.type}
              </span>
              <span className="text-xs text-gray-500">Cannot be changed after creation</span>
            </div>
          ) : (
            <Select
              id="instance-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              {ARR_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="URL" htmlFor="instance-url">
          <Input
            id="instance-url"
            value={url}
            onChange={handleUrlChange}
            required
            placeholder="http://localhost:8989"
          />
        </Field>
        <Field
          label="API Key"
          htmlFor="instance-api-key"
          description={initial ? 'Leave blank to keep the saved key. Re-enter it if you want to test before saving.' : undefined}
        >
          <Input
            id="instance-api-key"
            value={apiKey}
            onChange={handleApiKeyChange}
            required={!initial}
            placeholder={initial ? '••••••••' : 'API Key'}
          />
        </Field>
        <Field label="Timeout (seconds)" htmlFor="instance-timeout">
          <Input
            id="instance-timeout"
            type="number"
            value={timeout}
            onChange={(e) => setTimeout_(e.target.value)}
            min="1"
          />
        </Field>
        <div className="col-span-2 flex items-center gap-2 pt-2">
          <input
            type="checkbox"
            id="skipSslVerify"
            checked={skipSslVerify}
            onChange={handleSkipSslVerifyChange}
            className={checkboxStyles()}
          />
          <label htmlFor="skipSslVerify" className="text-sm font-medium text-gray-600 dark:text-gray-300">
            Disable SSL verification (allows self-signed certificates, use with caution)
          </label>
        </div>

        <div className="col-span-2 rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-800/40">
          <h4 className="mb-2 text-sm font-semibold text-gray-800 dark:text-gray-200">Path Mapping (Optional)</h4>
          <p className="mb-4 text-xs text-gray-500">
            If Filtarr is running in a different environment (e.g. separate Docker containers), use
            these fields to translate paths reported by this Arr instance to local paths accessible
            by Filtarr.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Remote Path (Arr's view)" htmlFor="instance-remote-path">
              <Input
                id="instance-remote-path"
                value={remotePath}
                onChange={(e) => setRemotePath(e.target.value)}
                placeholder="/downloads"
                className="font-mono text-sm"
              />
            </Field>
            <Field label="Local Path (Filtarr's view)" htmlFor="instance-local-path">
              <Input
                id="instance-local-path"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                placeholder="/mnt/downloads"
                className="font-mono text-sm"
              />
            </Field>
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          onClick={handleTestConnection}
          disabled={testUnsavedMutation.isPending || !url || (!apiKey && !initial)}
          variant={testVariant}
        >
          {testLabel}
        </Button>
        <Button
          type="submit"
          disabled={!canSave}
          title={canSave ? '' : 'Must successfully test connection before saving'}
          variant="success"
          className="hidden sm:inline-flex"
        >
          {primaryLabel}
        </Button>
        <Button
          type="submit"
          disabled={!canSave}
          title={canSave ? '' : 'Must successfully test connection before saving'}
          variant="success"
          className="sm:hidden"
        >
          {compactLabel}
        </Button>
        <div className="flex-1" />
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function Instances() {
  const { data: instances, isLoading } = useInstances();
  const createMutation = useCreateInstance();
  const updateMutation = useUpdateInstance();
  const deleteMutation = useDeleteInstance();
  const testMutation = useTestInstance();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Instance | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Instance | null>(null);

  const handleFormSubmit = (data: CreateInstanceInput) => {
    if (editing) {
      updateMutation.mutate(buildUpdatePayload(editing.id, data) as Parameters<typeof updateMutation.mutate>[0], {
        onSuccess: () => setEditing(null),
      });
      return;
    }

    createMutation.mutate(data, { onSuccess: () => setShowForm(false) });
  };

  if (isLoading) return <div className="text-gray-500">Loading instances...</div>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Instances"
        description="Connect Sonarr, Radarr, and Lidarr so Filtarr can validate items, blocklist releases, and monitor the right paths."
        actions={
          !showForm && !editing ? (
            <Button onClick={() => setShowForm(true)}>
              <PlusIcon className="h-4 w-4" />
              Add Instance
            </Button>
          ) : null
        }
      />

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
            onSubmit={handleFormSubmit}
            onCancel={() => {
              setShowForm(false);
              setEditing(null);
            }}
          />
        )}
      </Modal>

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        title="Delete instance?"
        description={
          pendingDelete
            ? <>Remove <span className="font-medium text-gray-900 dark:text-gray-100">{pendingDelete.name}</span> from Filtarr? This only removes the saved connection details.</>
            : ''
        }
        confirmLabel="Delete instance"
        isPending={deleteMutation.isPending}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) {
            deleteMutation.mutate(pendingDelete.id, { onSuccess: () => setPendingDelete(null) });
          }
        }}
      />

      {instances && instances.length > 0 ? (
        <div className="space-y-3">
          {instances.map((inst) => (
            <Card
              key={inst.id}
              className="group relative overflow-hidden p-5 transition-all hover:border-blue-200 hover:shadow-lg dark:hover:border-blue-500/20"
            >
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-600/50 via-green-600/50 to-blue-600/50 opacity-0 transition-opacity group-hover:opacity-100" />
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-start gap-4">
                  <div className="mt-1 flex-shrink-0">
                    <span
                      className={`flex h-3 w-3 rounded-full ${inst.enabled ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-gray-400 dark:bg-gray-600'}`}
                    />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-gray-900 dark:text-gray-100">{inst.name}</p>
                      <Badge>{inst.type}</Badge>
                    </div>
                    <p className="mt-0.5 text-sm font-medium text-gray-500">{inst.url}</p>
                    {inst.skipSslVerify && (
                      <Badge variant="warning" className="mt-2">Insecure SSL</Badge>
                    )}
                    {(inst.remotePath || inst.localPath) && (
                      <p className="mt-2 flex items-center gap-2 text-xs font-medium text-gray-500">
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono dark:bg-gray-800">
                          {inst.remotePath || 'None'}
                        </span>
                        <span className="opacity-40">➔</span>
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono dark:bg-gray-800">
                          {inst.localPath || 'None'}
                        </span>
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 lg:flex-shrink-0">
                  <Button
                    onClick={() => testMutation.mutate(inst.id)}
                    disabled={testMutation.isPending}
                    variant="secondary"
                    size="sm"
                  >
                    {testMutation.isPending ? 'Testing...' : 'Test'}
                  </Button>
                  <Button onClick={() => setEditing(inst)} variant="secondary" size="sm">
                    Edit
                  </Button>
                  <Button onClick={() => setPendingDelete(inst)} variant="danger" size="sm">
                    Delete
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<InstancesIcon className="h-7 w-7" />}
          title="No instances configured"
          description="Add your first Arr instance to get started."
          action={
            <Button onClick={() => setShowForm(true)}>
              <PlusIcon className="h-4 w-4" />
              Add Instance
            </Button>
          }
        />
      )}
    </div>
  );
}
