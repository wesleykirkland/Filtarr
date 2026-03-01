import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { toast } from '../components/Toast';
import { Modal } from '../components/Modal';
import { FilesystemPicker } from '../components/FilesystemPicker';
import { useTheme } from '../contexts/ThemeContext';

interface Instance {
  id: number;
  name: string;
  type: string;
  remotePath?: string | null;
  localPath?: string | null;
}

interface Preset {
  id: string;
  name: string;
  description: string;
  ruleType: Filter['rule_type'];
  rulePayload: string;
  actionType: Filter['action_type'];
  actionPayload?: string;
}

interface Filter {
  id: number;
  name: string;
  description?: string;
  trigger_source: string;
  rule_type: 'regex' | 'extension' | 'size' | 'script';
  rule_payload: string;
  action_type: 'blocklist' | 'delete' | 'move' | 'script' | 'notify';
  action_payload?: string;
  target_path?: string;
  is_built_in: number;
  notify_on_match: number;
  notify_webhook_url?: string;
  instance_id: number | null;
  enabled: number;
  sort_order: number;
  created_at: string;
}

const RULE_TYPE_LABELS: Record<Filter['rule_type'], string> = {
  regex: 'Regex Pattern',
  extension: 'File Extension',
  size: 'File Size',
  script: 'Custom Script',
};

const ACTION_TYPE_LABELS: Record<Filter['action_type'], string> = {
  blocklist: 'Blocklist in Arr',
  delete: 'Delete File',
  move: 'Move to Folder',
  script: 'Run Script',
  notify: 'Send Notification',
};

const RULE_PLACEHOLDERS: Record<Filter['rule_type'], string> = {
  regex: 'e.g. .*\\.exe$',
  extension: 'e.g. exe,bat,sh',
  size: 'e.g. >100MB or <1KB',
  script: '// JS — return true to match\nreturn file.name.endsWith(".exe");',
};

const ACTION_BADGE: Record<Filter['action_type'], string> = {
  blocklist: 'bg-red-500/20 text-red-400',
  delete: 'bg-orange-500/20 text-orange-400',
  move: 'bg-blue-500/20 text-blue-400',
  script: 'bg-purple-500/20 text-purple-400',
  notify: 'bg-green-500/20 text-green-400',
};

const TYPE_COLORS: Record<string, string> = {
  sonarr: 'bg-blue-500/20 text-blue-400',
  radarr: 'bg-yellow-500/20 text-yellow-400',
  lidarr: 'bg-green-500/20 text-green-400',
};

interface FilterFormProps {
  initial?: Filter;
  instances: Instance[];
  onClose: () => void;
  onSaved: () => void;
}

function FilterForm({ initial, instances, onClose, onSaved }: FilterFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [ruleType, setRuleType] = useState<Filter['rule_type']>(initial?.rule_type ?? 'extension');
  const [rulePayload, setRulePayload] = useState(initial?.rule_payload ?? '');
  const [actionType, setActionType] = useState<Filter['action_type']>(
    initial?.action_type ?? 'blocklist',
  );
  const [actionPayload, setActionPayload] = useState(initial?.action_payload ?? '');
  const [targetPath, setTargetPath] = useState(initial?.target_path ?? '');
  const [instanceId, setInstanceId] = useState<number | undefined>(
    initial?.instance_id ?? (instances.length === 1 ? instances[0].id : undefined),
  );
  const [notifyOnMatch, setNotifyOnMatch] = useState(!!initial?.notify_on_match);
  const [notifyWebhookUrl, setNotifyWebhookUrl] = useState(initial?.notify_webhook_url ?? '');
  const [enabled, setEnabled] = useState(initial ? !!initial.enabled : true);
  const [showPicker, setShowPicker] = useState(false);
  const [showPresets, setShowPresets] = useState(!initial);
  const [err, setErr] = useState('');

  const { data: presets = [] } = useQuery<Preset[]>({
    queryKey: ['filter-presets'],
    queryFn: () => api.get('/filters/presets'),
    enabled: showPresets,
  });

  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      initial ? api.put(`/filters/${initial.id}`, body) : api.post('/filters', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['filters'] });
      toast('success', initial ? 'Filter updated' : 'Filter created');
      onSaved();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const applyPreset = (p: Preset) => {
    setName(p.name);
    setRuleType(p.ruleType);
    setRulePayload(p.rulePayload);
    setActionType(p.actionType);
    setActionPayload(p.actionPayload ?? '');
    setShowPresets(false);
  };

  const handleSubmit = (evt: React.FormEvent) => {
    evt.preventDefault();
    if (!instanceId) {
      setErr('Please select an Arr instance');
      return;
    }
    setErr('');
    mutation.mutate({
      name,
      description: description || undefined,
      triggerSource: 'watcher',
      ruleType,
      rulePayload,
      actionType,
      actionPayload: actionPayload || undefined,
      targetPath: targetPath || undefined,
      instanceId,
      notifyOnMatch,
      notifyWebhookUrl: notifyWebhookUrl || undefined,
      enabled,
    });
  };

  const isScript = ruleType === 'script';

  return (
    <>
      {showPicker && (
        <FilesystemPicker
          value={targetPath}
          onSelect={setTargetPath}
          onClose={() => setShowPicker(false)}
        />
      )}

      {showPresets && !initial ? (
        <div className="space-y-4">
          <p className="text-sm dark:text-gray-400 text-gray-600">
            Choose a preset to start with or create a custom filter.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setShowPresets(false)}
              className="flex flex-col items-start rounded-xl border-2 border-dashed dark:border-gray-800 border-gray-200 p-4 text-left transition-colors dark:hover:border-blue-500/50 hover:border-blue-500/50 dark:hover:bg-blue-500/5 hover:bg-blue-50"
            >
              <span className="font-semibold dark:text-gray-100 text-gray-900">Custom Filter</span>
              <span className="mt-1 text-xs dark:text-gray-500 text-gray-600">
                Start from scratch with your own rules.
              </span>
            </button>
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p)}
                className="flex flex-col items-start rounded-xl border dark:border-gray-800 border-gray-200 p-4 text-left transition-colors dark:hover:border-blue-500 hover:border-blue-500 dark:hover:bg-blue-500/5 hover:bg-blue-50"
              >
                <span className="font-semibold dark:text-gray-100 text-gray-900">{p.name}</span>
                <span className="mt-1 text-xs dark:text-gray-500 text-gray-600 line-clamp-2">
                  {p.description}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          {err && (
            <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {err}
            </div>
          )}

          {/* Name + Description */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium dark:text-gray-400 text-gray-700">
                Filter Name *
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="mt-1 block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium dark:text-gray-400 text-gray-700">
                Description
              </label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-1 block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Target path */}
          <div>
            <label className="block text-sm font-medium dark:text-gray-400 text-gray-700">
              Target Path
            </label>
            <p className="text-xs dark:text-gray-500 text-gray-600 mb-1">
              Directory this filter monitors (e.g. your Radarr download folder)
            </p>
            <div className="flex gap-2">
              <input
                value={targetPath}
                onChange={(e) => setTargetPath(e.target.value)}
                placeholder="/downloads/complete"
                className="flex-1 rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none font-mono text-sm"
              />
              <button
                type="button"
                onClick={() => setShowPicker(true)}
                className="rounded-lg border dark:border-gray-700 border-gray-300 px-3 py-2 text-sm dark:text-gray-400 text-gray-600 dark:hover:bg-gray-800 hover:bg-gray-100 whitespace-nowrap"
              >
                📁 Browse
              </button>
            </div>
          </div>

          {/* Rule + Action */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium dark:text-gray-400 text-gray-700">
                Rule Type
              </label>
              <select
                value={ruleType}
                onChange={(e) => setRuleType(e.target.value as Filter['rule_type'])}
                className="mt-1 block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none"
              >
                {Object.entries(RULE_TYPE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium dark:text-gray-400 text-gray-700">
                Action on Match
              </label>
              <select
                value={actionType}
                onChange={(e) => setActionType(e.target.value as Filter['action_type'])}
                className="mt-1 block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none"
              >
                {Object.entries(ACTION_TYPE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium dark:text-gray-400 text-gray-700">
                {RULE_TYPE_LABELS[ruleType]} *
              </label>
              {isScript ? (
                <textarea
                  value={rulePayload}
                  onChange={(e) => setRulePayload(e.target.value)}
                  required
                  rows={5}
                  placeholder={RULE_PLACEHOLDERS[ruleType]}
                  className="mt-1 block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 font-mono text-sm dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none"
                />
              ) : (
                <input
                  value={rulePayload}
                  onChange={(e) => setRulePayload(e.target.value)}
                  required
                  placeholder={RULE_PLACEHOLDERS[ruleType]}
                  className="mt-1 block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none"
                />
              )}
            </div>
            {(actionType === 'move' || actionType === 'script') && (
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium dark:text-gray-400 text-gray-700">
                  {actionType === 'move' ? 'Destination Path' : 'Script Payload'}
                </label>
                <input
                  value={actionPayload}
                  onChange={(e) => setActionPayload(e.target.value)}
                  placeholder={actionType === 'move' ? '/mnt/quarantine' : '// JS script'}
                  className="mt-1 block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none"
                />
              </div>
            )}
          </div>

          {/* Arr Instance selection */}
          {/* Arr Instance selection */}
          <div>
            <label className="block text-sm font-medium dark:text-gray-400 text-gray-700">
              Arr Instance *
            </label>
            <p className="text-xs dark:text-gray-500 text-gray-600 mb-2">
              Which Arr instance should this filter act on?
            </p>
            {instances.length === 0 ? (
              <p className="text-sm dark:text-gray-500 text-gray-600 italic">
                No instances configured yet.
              </p>
            ) : (
              <select
                value={instanceId || ''}
                onChange={(e) => setInstanceId(Number(e.target.value) || undefined)}
                required
                className="mt-1 block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none"
              >
                <option value="" disabled>
                  Select an instance...
                </option>
                {instances.map((inst) => (
                  <option key={inst.id} value={inst.id}>
                    {inst.name} ({inst.type})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Notifications */}
          <div className="rounded-lg border dark:border-gray-800 border-gray-200 dark:bg-gray-800/30 bg-gray-50 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="notifyOnMatch"
                checked={notifyOnMatch}
                onChange={(e) => setNotifyOnMatch(e.target.checked)}
                className="h-4 w-4 rounded dark:border-gray-700 border-gray-300"
              />
              <label
                htmlFor="notifyOnMatch"
                className="text-sm font-medium dark:text-gray-300 text-gray-700"
              >
                🔔 Notify on match
              </label>
            </div>
            {notifyOnMatch && (
              <div>
                <label className="block text-xs font-medium dark:text-gray-400 text-gray-700 mb-1">
                  Webhook URL
                </label>
                <input
                  type="url"
                  value={notifyWebhookUrl}
                  onChange={(e) => setNotifyWebhookUrl(e.target.value)}
                  placeholder="https://hooks.slack.com/services/... or https://discord.com/api/webhooks/..."
                  className="block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none text-sm"
                />
                <p className="mt-1 text-xs dark:text-gray-500 text-gray-600">
                  Filtarr will POST a JSON payload to this URL when the filter matches a file.
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="filterEnabled"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 rounded dark:border-gray-700 border-gray-300"
            />
            <label
              htmlFor="filterEnabled"
              className="text-sm font-medium dark:text-gray-400 text-gray-600"
            >
              Enabled
            </label>
          </div>

          <div className="flex gap-2 border-t dark:border-gray-800 border-gray-200 pt-4">
            <button
              type="submit"
              disabled={mutation.isPending}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {mutation.isPending ? 'Saving...' : initial ? 'Update Filter' : 'Create Filter'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border dark:border-gray-700 border-gray-300 px-4 py-2 text-sm font-medium dark:text-gray-400 text-gray-700 dark:hover:bg-gray-800 hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </>
  );
}

interface FilterCardProps {
  filter: Filter;
  instances: Instance[];
  onEdit: () => void;
  onToggle: () => void;
  onDelete: (() => void) | null;
}

function FilterCard({ filter: f, instances, onEdit, onToggle, onDelete }: FilterCardProps) {
  const linkedInstance = instances.find((i) => i.id === f.instance_id);
  const { darkMode } = useTheme();

  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border p-5 transition-all hover:shadow-xl ${
        darkMode
          ? 'bg-gray-800/40 border-gray-800 hover:border-gray-700/50'
          : 'bg-white border-gray-200'
      }`}
    >
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-600/50 via-purple-600/50 to-blue-600/50 opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <button
            onClick={onToggle}
            className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${f.enabled ? 'bg-blue-600' : 'dark:bg-gray-700 bg-gray-300'}`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${f.enabled ? 'translate-x-4' : 'translate-x-0'}`}
            />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="font-semibold dark:text-gray-100 text-gray-900">{f.name}</h3>
              {!!f.is_built_in && (
                <span className="rounded bg-indigo-500/20 text-indigo-400 px-2 py-0.5 text-[11px] font-medium uppercase">
                  Built-in
                </span>
              )}
              <span
                className={`rounded px-2 py-0.5 text-[11px] font-medium uppercase ${ACTION_BADGE[f.action_type]}`}
              >
                {ACTION_TYPE_LABELS[f.action_type]}
              </span>
              {!!f.notify_on_match && (
                <span title="Webhook notification enabled" className="text-xs">
                  🔔
                </span>
              )}
            </div>
            {f.description && (
              <p className="mt-0.5 text-sm dark:text-gray-500 text-gray-600 truncate">
                {f.description}
              </p>
            )}
            <div className="mt-1 flex flex-wrap gap-3 text-xs dark:text-gray-400 text-gray-600">
              <span>
                <span className="dark:text-gray-500 text-gray-500">
                  {RULE_TYPE_LABELS[f.rule_type]}:
                </span>{' '}
                <span className="font-mono">{f.rule_payload}</span>
              </span>
              {f.target_path && (
                <span className="font-mono dark:bg-gray-800 bg-gray-100 px-1.5 py-0.5 rounded">
                  {f.target_path}
                </span>
              )}
            </div>
            {linkedInstance && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <span
                  className={`rounded px-2 py-0.5 text-[11px] font-medium ${TYPE_COLORS[linkedInstance.type] ?? 'bg-gray-500/20 text-gray-400'}`}
                >
                  {linkedInstance.name}
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={onEdit}
            className="rounded-lg border dark:border-gray-700 border-gray-300 px-3 py-1.5 text-xs font-medium dark:text-gray-400 text-gray-700 dark:hover:bg-gray-800 hover:bg-gray-100"
          >
            Edit
          </button>
          {onDelete ? (
            <button
              onClick={onDelete}
              className="rounded-lg border dark:border-red-900 border-red-200 px-3 py-1.5 text-xs font-medium dark:text-red-400 text-red-600 dark:hover:bg-red-900/30 hover:bg-red-50"
            >
              Delete
            </button>
          ) : (
            <span
              title="Built-in filters cannot be deleted"
              className="rounded-lg border dark:border-gray-800 border-gray-200 px-3 py-1.5 text-xs font-medium dark:text-gray-600 text-gray-400 cursor-not-allowed"
            >
              Protected
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Filters() {
  const queryClient = useQueryClient();
  const { darkMode } = useTheme();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Filter | null>(null);

  const { data: filters = [], isLoading } = useQuery<Filter[]>({
    queryKey: ['filters'],
    queryFn: () => api.get('/filters'),
  });

  const { data: instances = [] } = useQuery<Instance[]>({
    queryKey: ['instances'],
    queryFn: () => api.get('/instances'),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      api.put(`/filters/${id}`, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['filters'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/filters/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['filters'] });
      toast('success', 'Filter deleted');
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const isModalOpen = showForm || editing !== null;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight dark:text-gray-100 text-gray-900">
            Filters
          </h2>
          <p className="mt-1 text-sm dark:text-gray-400 text-gray-600">
            Automate file management across your Arr instances with custom matching rules.
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg transition-all hover:bg-blue-500 hover:shadow-blue-500/25 active:scale-95"
        >
          <span>+</span> Add Filter
        </button>
      </div>

      <div
        className={`relative overflow-hidden rounded-2xl border p-6 ${
          darkMode ? 'bg-blue-500/10 border-blue-500/30' : 'bg-blue-50 border-blue-200'
        }`}
      >
        <div className="absolute top-0 right-0 p-4 text-4xl opacity-10">🔍</div>
        <div className="relative flex items-center gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600/20 text-blue-500">
            💡
          </div>
          <p
            className={`text-sm font-medium leading-relaxed ${darkMode ? 'text-blue-100' : 'text-blue-900'}`}
          >
            Each filter monitors a <strong>target path</strong> for matching files. On match, it
            executes actions against its <strong>linked Arr instance</strong>. Use the{' '}
            <strong>Scheduler</strong> to run filters on a recurring basis.
          </p>
        </div>
      </div>

      <Modal
        title={editing ? 'Edit Filter' : 'Add Filter'}
        isOpen={isModalOpen}
        onClose={() => {
          setShowForm(false);
          setEditing(null);
        }}
      >
        <FilterForm
          initial={editing ?? undefined}
          instances={instances}
          onClose={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSaved={() => {
            setShowForm(false);
            setEditing(null);
          }}
        />
      </Modal>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center rounded-2xl border-2 border-dashed dark:border-gray-800 border-gray-200 bg-gray-50/50 dark:bg-gray-900/20">
          <p className="dark:text-gray-500 text-gray-400">Loading filters...</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filters.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-3xl border-2 border-dashed dark:border-gray-800 border-gray-200 bg-gray-50/30 dark:bg-gray-900/10 p-16 text-center">
              <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-3xl bg-gray-100 dark:bg-gray-800 text-5xl">
                ✨
              </div>
              <h3 className="text-xl font-bold dark:text-gray-200 text-gray-800">
                No filters configured
              </h3>
              <p className="mt-3 max-w-sm text-sm dark:text-gray-500 text-gray-500">
                Kickstart your automation by creating your first filter using our presets or a
                custom rule.
              </p>
              <button
                onClick={() => setShowForm(true)}
                className="mt-8 rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white transition-transform hover:scale-105 active:scale-95"
              >
                Add Your First Filter
              </button>
            </div>
          ) : (
            <div className="grid gap-4">
              {filters.map((f) => (
                <FilterCard
                  key={f.id}
                  filter={f}
                  instances={instances}
                  onEdit={() => setEditing(f)}
                  onToggle={() => toggleMutation.mutate({ id: f.id, enabled: !f.enabled })}
                  onDelete={() => {
                    if (confirm(`Delete filter "${f.name}"?`)) deleteMutation.mutate(f.id);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
