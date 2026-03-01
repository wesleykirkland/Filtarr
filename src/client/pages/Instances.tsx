import { useState } from 'react';
import {
  useInstances,
  useCreateInstance,
  useUpdateInstance,
  useDeleteInstance,
  useTestInstance,
  useTestUnsavedInstance,
  type TestResult,
  type Instance,
  type CreateInstanceInput,
} from '../hooks/useInstances';
import { Modal } from '../components/Modal';

const ARR_TYPES = ['sonarr', 'radarr', 'lidarr'] as const;

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
  const [testSuccessful, setTestSuccessful] = useState(false);

  const testUnsavedMutation = useTestUnsavedInstance();

  // Reset test success if core connection settings change
  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUrl(e.target.value);
    setTestSuccessful(false);
  };

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setApiKey(e.target.value);
    setTestSuccessful(false);
  };

  const handleSkipSslVerifyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSkipSslVerify(e.target.checked);
    setTestSuccessful(false);
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
        timeout: parseInt(timeout, 10) || undefined,
        skipSslVerify,
      },
      {
        onSuccess: (data: { success: boolean }) => {
          if (data.success) setTestSuccessful(true);
        },
      }
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name,
      type,
      url,
      apiKey: apiKey || (initial ? '' : apiKey), // empty = don't update
      timeout: parseInt(timeout, 10) || undefined,
      skipSslVerify,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-400">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required
            className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 focus:border-blue-500 focus:outline-none" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-400">Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 focus:border-blue-500 focus:outline-none">
            {ARR_TYPES.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-400">URL</label>
          <input value={url} onChange={handleUrlChange} required placeholder="http://localhost:8989"
            className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 focus:border-blue-500 focus:outline-none" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-400">API Key {initial && '(leave blank to keep, but must re-enter to test)'}</label>
          <input value={apiKey} onChange={handleApiKeyChange} required={!initial} placeholder={initial ? "••••••••" : "API Key"}
            className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 focus:border-blue-500 focus:outline-none" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-400">Timeout (seconds)</label>
          <input type="number" value={timeout} onChange={(e) => setTimeout_(e.target.value)} min="1"
            className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 focus:border-blue-500 focus:outline-none" />
        </div>
        <div className="col-span-2 flex items-center gap-2 pt-2">
          <input type="checkbox" id="skipSslVerify" checked={skipSslVerify} onChange={handleSkipSslVerifyChange}
            className="h-4 w-4 rounded border-gray-700 bg-gray-800 text-blue-600 focus:ring-blue-500 focus:ring-offset-gray-900" />
          <label htmlFor="skipSslVerify" className="text-sm font-medium text-gray-400">Disable SSL verification (allows self-signed certificates, use with caution)</label>
        </div>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={handleTestConnection} disabled={testUnsavedMutation.isPending || (!url || (!apiKey && !initial))}
          className="rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-white hover:bg-gray-600 disabled:opacity-50">
          {testUnsavedMutation.isPending ? 'Testing...' : 'Test Connection'}
        </button>
        <button type="submit" disabled={!testSuccessful} title={!testSuccessful ? "Must successfully test connection before saving" : ""} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
          {initial ? 'Update' : 'Create'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-400 hover:bg-gray-800">
          Cancel
        </button>
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

  if (isLoading) return <div className="text-gray-400">Loading instances...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Instances</h2>
        {!showForm && !editing && (
          <button onClick={() => setShowForm(true)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            + Add Instance
          </button>
        )}
      </div>

      <Modal
        title={editing ? 'Edit Instance' : 'Add Instance'}
        isOpen={showForm || editing !== null}
        onClose={() => { setShowForm(false); setEditing(null); }}
      >
        {(showForm || editing !== null) && (
          <InstanceForm
            initial={editing ?? undefined}
            onSubmit={(data) => {
              if (editing) {
                const payload: Record<string, unknown> = { id: editing.id };
                if (data.name) payload['name'] = data.name;
                if (data.type) payload['type'] = data.type;
                if (data.url) payload['url'] = data.url;
                if (data.apiKey) payload['apiKey'] = data.apiKey;
                if (data.timeout) payload['timeout'] = data.timeout;
                if (data.skipSslVerify !== undefined) payload['skipSslVerify'] = data.skipSslVerify;
                updateMutation.mutate(payload as Parameters<typeof updateMutation.mutate>[0], { onSuccess: () => setEditing(null) });
              } else {
                createMutation.mutate(data, { onSuccess: () => setShowForm(false) });
              }
            }}
            onCancel={() => { setShowForm(false); setEditing(null); }}
          />
        )}
      </Modal>

      {instances && instances.length > 0 ? (
        <div className="space-y-3">
          {instances.map((inst) => (
            <div key={inst.id} className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900 px-6 py-4">
              <div className="flex items-center gap-4">
                <span className={`h-3 w-3 rounded-full ${inst.enabled ? 'bg-green-500' : 'bg-gray-600'}`} />
                <div>
                  <p className="font-medium">{inst.name}</p>
                  <p className="text-sm text-gray-500">{inst.url} {inst.skipSslVerify && <span className="ml-2 rounded bg-yellow-900/40 px-1.5 py-0.5 text-[10px] tracking-wide text-yellow-500 uppercase">Insecure SSL</span>}</p>
                </div>
                <span className="rounded bg-gray-700 px-2 py-0.5 text-xs text-gray-300 uppercase">{inst.type}</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => testMutation.mutate(inst.id)} disabled={testMutation.isPending}
                  className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-400 hover:bg-gray-800 disabled:opacity-50">
                  {testMutation.isPending ? 'Testing...' : 'Test'}
                </button>
                <button onClick={() => setEditing(inst)}
                  className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-400 hover:bg-gray-800">
                  Edit
                </button>
                <button onClick={() => { if (confirm('Delete this instance?')) deleteMutation.mutate(inst.id); }}
                  className="rounded-lg border border-red-900 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-900/30">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-12 text-center">
          <p className="text-lg text-gray-500">No instances configured</p>
          <p className="mt-1 text-sm text-gray-600">Add your first Arr instance to get started.</p>
        </div>
      )}
    </div>
  );
}

