import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { toast } from '../components/Toast';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FiltersIcon, PlusIcon } from '../components/Icons';
import { Modal } from '../components/Modal';
import { FilesystemPicker } from '../components/FilesystemPicker';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
  checkboxStyles,
} from '../components/ui';

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
  notify_webhook_url?: string | null;
  notify_webhook_url_configured?: boolean;
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
  const [clearStoredWebhook, setClearStoredWebhook] = useState(false);
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
      notifyWebhookUrl: clearStoredWebhook ? '' : notifyWebhookUrl || undefined,
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
          <p className="text-sm text-gray-500">Choose a preset to start with or create a custom filter.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setShowPresets(false)}
              className="flex flex-col items-start rounded-2xl border-2 border-dashed border-gray-200 p-4 text-left transition-colors hover:border-blue-500/50 hover:bg-blue-50 dark:border-gray-800 dark:hover:bg-blue-500/5"
            >
              <span className="font-semibold text-gray-900 dark:text-gray-100">Custom Filter</span>
              <span className="mt-1 text-xs text-gray-500">
                Start from scratch with your own rules.
              </span>
            </button>
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p)}
                className="flex flex-col items-start rounded-2xl border border-gray-200 p-4 text-left transition-colors hover:border-blue-500 hover:bg-blue-50 dark:border-gray-800 dark:hover:bg-blue-500/5"
              >
                <span className="font-semibold text-gray-900 dark:text-gray-100">{p.name}</span>
                <span className="mt-1 line-clamp-2 text-xs text-gray-500">
                  {p.description}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          {err && (
            <div className="rounded-xl border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300">
              {err}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Filter Name *" htmlFor="filter-name">
              <Input
                id="filter-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </Field>
            <Field label="Description" htmlFor="filter-description">
              <Input
                id="filter-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
          </div>

          <Field
            label="Target Path"
            htmlFor="filter-target-path"
            description="Directory this filter monitors (for example your Radarr download folder)."
          >
            <div className="flex gap-2">
              <Input
                id="filter-target-path"
                value={targetPath}
                onChange={(e) => setTargetPath(e.target.value)}
                placeholder="/downloads/complete"
                className="flex-1 font-mono text-sm"
              />
              <Button type="button" variant="secondary" onClick={() => setShowPicker(true)}>
                📁 Browse
              </Button>
            </div>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Rule Type" htmlFor="filter-rule-type">
              <Select
                id="filter-rule-type"
                value={ruleType}
                onChange={(e) => setRuleType(e.target.value as Filter['rule_type'])}
              >
                {Object.entries(RULE_TYPE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Action on Match" htmlFor="filter-action-type">
              <Select
                id="filter-action-type"
                value={actionType}
                onChange={(e) => setActionType(e.target.value as Filter['action_type'])}
              >
                {Object.entries(ACTION_TYPE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={`${RULE_TYPE_LABELS[ruleType]} *`} htmlFor="filter-rule-payload" className="sm:col-span-2">
              {isScript ? (
                <Textarea
                  id="filter-rule-payload"
                  value={rulePayload}
                  onChange={(e) => setRulePayload(e.target.value)}
                  required
                  rows={5}
                  placeholder={RULE_PLACEHOLDERS[ruleType]}
                  className="font-mono text-sm"
                />
              ) : (
                <Input
                  id="filter-rule-payload"
                  value={rulePayload}
                  onChange={(e) => setRulePayload(e.target.value)}
                  required
                  placeholder={RULE_PLACEHOLDERS[ruleType]}
                />
              )}
            </Field>
            {(actionType === 'move' || actionType === 'script') && (
              <Field
                label={actionType === 'move' ? 'Destination Path' : 'Script Payload'}
                htmlFor="filter-action-payload"
                className="sm:col-span-2"
              >
                <Input
                  id="filter-action-payload"
                  value={actionPayload}
                  onChange={(e) => setActionPayload(e.target.value)}
                  placeholder={actionType === 'move' ? '/mnt/quarantine' : '// JS script'}
                />
              </Field>
            )}
          </div>

          <Field label="Arr Instance *" htmlFor="filter-instance" description="Which Arr instance should this filter act on?">
            {instances.length === 0 ? (
              <p className="text-sm italic text-gray-500">No instances configured yet.</p>
            ) : (
              <Select
                id="filter-instance"
                value={instanceId || ''}
                onChange={(e) => setInstanceId(Number(e.target.value) || undefined)}
                required
              >
                <option value="" disabled>
                  Select an instance...
                </option>
                {instances.map((inst) => (
                  <option key={inst.id} value={inst.id}>
                    {inst.name} ({inst.type})
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <div className="space-y-3 rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-800/30">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="notifyOnMatch"
                checked={notifyOnMatch}
                onChange={(e) => setNotifyOnMatch(e.target.checked)}
                className={checkboxStyles()}
              />
              <label htmlFor="notifyOnMatch" className="text-sm font-medium text-gray-700 dark:text-gray-200">
                🔔 Notify on match
              </label>
            </div>
            {notifyOnMatch && (
              <Field label="Webhook URL" htmlFor="filter-webhook-url" description="Filtarr will POST a JSON payload to this URL when the filter matches a file.">
                <Input
                  id="filter-webhook-url"
                  type="url"
                  value={notifyWebhookUrl}
                  onChange={(e) => {
                    setNotifyWebhookUrl(e.target.value);
                    if (e.target.value) setClearStoredWebhook(false);
                  }}
                  placeholder={
                    initial?.notify_webhook_url_configured
                      ? 'Enter a new webhook URL to replace the stored one'
                      : 'https://hooks.slack.com/services/... or https://discord.com/api/webhooks/...'
                  }
                />
                {initial?.notify_webhook_url_configured && (
                  <div className="mt-3 rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-300">
                    <p>A webhook URL is already stored for this filter.</p>
                    <label className="mt-2 flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={clearStoredWebhook}
                        onChange={(e) => {
                          setClearStoredWebhook(e.target.checked);
                          if (e.target.checked) setNotifyWebhookUrl('');
                        }}
                        disabled={Boolean(notifyWebhookUrl)}
                        className={checkboxStyles()}
                      />
                      <span>Clear the stored webhook on save</span>
                    </label>
                  </div>
                )}
              </Field>
            )}
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="filterEnabled"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className={checkboxStyles()}
            />
            <label htmlFor="filterEnabled" className="text-sm font-medium text-gray-600 dark:text-gray-300">
              Enabled
            </label>
          </div>

          <div className="flex gap-2 border-t border-gray-200 pt-4 dark:border-gray-800">
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving...' : initial ? 'Update Filter' : 'Create Filter'}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
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

  return (
    <Card className="group relative overflow-hidden p-5 transition-all hover:border-blue-200 hover:shadow-lg dark:hover:border-blue-500/20">
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
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">{f.name}</h3>
              {!!f.is_built_in && <Badge variant="info">Built-in</Badge>}
              <span className={`rounded px-2 py-0.5 text-[11px] font-medium uppercase ${ACTION_BADGE[f.action_type]}`}>
                {ACTION_TYPE_LABELS[f.action_type]}
              </span>
              {!!f.notify_on_match && (
                <span title="Webhook notification enabled" className="text-xs">
                  🔔
                </span>
              )}
            </div>
            {f.description && (
              <p className="mt-0.5 truncate text-sm text-gray-500">{f.description}</p>
            )}
            <div className="mt-1 flex flex-wrap gap-3 text-xs text-gray-500">
              <span>
                <span>{RULE_TYPE_LABELS[f.rule_type]}:</span>{' '}
                <span className="font-mono">{f.rule_payload}</span>
              </span>
              {f.target_path && (
                <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono dark:bg-gray-800">{f.target_path}</span>
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
          <Button onClick={onEdit} variant="secondary" size="sm">
            Edit
          </Button>
          {onDelete ? (
            <Button onClick={onDelete} variant="danger" size="sm">
              Delete
            </Button>
          ) : (
            <span title="Built-in filters cannot be deleted" className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-400 dark:border-gray-800 dark:text-gray-600">
              Protected
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function Filters() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Filter | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Filter | null>(null);

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
      setPendingDelete(null);
      toast('success', 'Filter deleted');
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const isModalOpen = showForm || editing !== null;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        title="Filters"
        description="Automate file management across your Arr instances with custom matching rules."
        actions={
          <Button onClick={() => setShowForm(true)}>
            <PlusIcon className="h-4 w-4" />
            Add Filter
          </Button>
        }
      />

      <Card className="relative overflow-hidden border-blue-200 bg-blue-50 p-6 dark:border-blue-500/30 dark:bg-blue-500/10">
        <div className="absolute top-0 right-0 p-4 text-4xl opacity-10">🔍</div>
        <div className="relative flex items-center gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600/20 text-blue-500">
            💡
          </div>
          <p className="text-sm font-medium leading-relaxed text-blue-900 dark:text-blue-100">
            Each filter monitors a <strong>target path</strong> for matching files. On match, it
            executes actions against its <strong>linked Arr instance</strong>. Use the{' '}
            <strong>Scheduler</strong> to run filters on a recurring basis.
          </p>
        </div>
      </Card>

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

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        title="Delete filter?"
        description={
          pendingDelete
            ? <>Delete <span className="font-medium text-gray-900 dark:text-gray-100">{pendingDelete.name}</span>? This removes the rule and its automation behavior.</>
            : ''
        }
        confirmLabel="Delete filter"
        isPending={deleteMutation.isPending}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
      />

      {isLoading ? (
        <div className="flex h-64 items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50/50 dark:border-gray-800 dark:bg-gray-900/20">
          <p className="text-gray-500">Loading filters...</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filters.length === 0 ? (
            <EmptyState
              icon={<FiltersIcon className="h-7 w-7" />}
              title="No filters configured"
              description="Kickstart your automation by creating your first filter using a preset or a custom rule."
              action={
                <Button onClick={() => setShowForm(true)}>
                  <PlusIcon className="h-4 w-4" />
                  Add Your First Filter
                </Button>
              }
            />
          ) : (
            <div className="grid gap-4">
              {filters.map((f) => (
                <FilterCard
                  key={f.id}
                  filter={f}
                  instances={instances}
                  onEdit={() => setEditing(f)}
                  onToggle={() => toggleMutation.mutate({ id: f.id, enabled: !f.enabled })}
                  onDelete={!f.is_built_in ? () => setPendingDelete(f) : null}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
