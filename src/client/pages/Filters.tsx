import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import {
  canDeleteFilter,
  FILTER_CARD_CLASS_NAME,
  getFilterNotificationChannels,
  hasConfiguredPath,
  trimToUndefined,
} from '../lib/filterUi';
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
  script_runtime: 'javascript' | 'shell';
  target_path?: string;
  is_built_in: number;
  notify_on_match: number;
  notify_webhook_url?: string;
  notify_slack: number;
  notify_slack_token?: string;
  notify_slack_channel?: string;
  override_notifications: number;
  instance_id: number | null;
  enabled: number;
  sort_order: number;
  created_at: string;
}

interface NotificationSettingsResponse {
  slackEnabled: boolean;
  webhookEnabled: boolean;
  defaultWebhookUrl: string;
  defaultSlackToken: string;
  defaultSlackChannel: string;
}

const RULE_TYPE_LABELS: Record<Filter['rule_type'], string> = {
  regex: 'Regex Pattern',
  extension: 'File Extension',
  size: 'File Size',
  script: 'Script Rule',
};

const ACTION_TYPE_LABELS: Record<Filter['action_type'], string> = {
  blocklist: 'Blocklist in Arr',
  delete: 'Delete File',
  move: 'Move to Folder',
  script: 'Run Script Action',
  notify: 'Send Notification',
};

const RULE_PLACEHOLDERS: Record<Filter['rule_type'], string> = {
  regex: 'e.g. .*\\.exe$',
  extension: 'e.g. exe,bat,sh',
  size: 'e.g. >100MB or <1KB',
  script: '// JS — return true to match\nreturn file.name.endsWith(".exe");',
};

const SCRIPT_RUNTIME_LABELS: Record<Filter['script_runtime'], string> = {
  shell: 'Shell script (bash)',
  javascript: 'Legacy JavaScript (sandbox)',
};

const SCRIPT_RULE_PLACEHOLDERS: Record<Filter['script_runtime'], string> = {
  javascript: '// JS — return true to match\nreturn context.file.name.endsWith(".exe");',
  shell:
    'if [[ "$FILTARR_FILE_NAME" == *.exe ]]; then\n  echo true\nfi',
};

const SCRIPT_ACTION_PLACEHOLDERS: Record<Filter['script_runtime'], string> = {
  javascript: '// JS action\nconsole.log(`Matched ${context.file.path}`);',
  shell: 'echo "Matched $FILTARR_FILE_PATH"',
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

function NotificationOverrideFields({
  overrideNotifications,
  notifyOnMatch,
  setNotifyOnMatch,
  notifyWebhookUrl,
  setNotifyWebhookUrl,
  notifySlack,
  setNotifySlack,
  notifySlackToken,
  setNotifySlackToken,
  notifySlackChannel,
  setNotifySlackChannel,
}: Readonly<{
  overrideNotifications: boolean;
  notifyOnMatch: boolean;
  setNotifyOnMatch: (v: boolean) => void;
  notifyWebhookUrl: string;
  setNotifyWebhookUrl: (v: string) => void;
  notifySlack: boolean;
  setNotifySlack: (v: boolean) => void;
  notifySlackToken: string;
  setNotifySlackToken: (v: string) => void;
  notifySlackChannel: string;
  setNotifySlackChannel: (v: string) => void;
}>) {
  if (!overrideNotifications) {
    return (
      <div className="rounded-lg border border-blue-200 bg-blue-50/80 px-3 py-3 text-xs text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-100">
        This filter will inherit the default notification destinations configured on the
        Settings page.
      </div>
    );
  }

  return (
    <div className="space-y-3 border-t border-gray-200 pt-3 dark:border-gray-800">
      <div className="space-y-3 rounded-xl border border-gray-200 bg-white/80 p-4 dark:border-gray-800 dark:bg-gray-950/40">
        <div className="flex items-center justify-between gap-3">
          <div>
            <label
              htmlFor="notifyOnMatch"
              className="text-sm font-medium dark:text-gray-300 text-gray-700"
            >
              Webhook notifications
            </label>
            <p className="text-xs dark:text-gray-500 text-gray-600">
              Send a JSON payload to a per-filter webhook when this filter matches.
            </p>
          </div>
          <input
            type="checkbox"
            id="notifyOnMatch"
            checked={notifyOnMatch}
            onChange={(e) => setNotifyOnMatch(e.target.checked)}
            className="h-4 w-4 rounded dark:border-gray-700 border-gray-300"
          />
        </div>
        {notifyOnMatch && (
          <div>
            <label htmlFor="filter-webhook-url" className="mb-1 block text-xs font-medium dark:text-gray-400 text-gray-700">
              Webhook URL *
            </label>
            <input
              id="filter-webhook-url"
              type="url"
              value={notifyWebhookUrl}
              onChange={(e) => setNotifyWebhookUrl(e.target.value)}
              placeholder="https://discord.com/api/webhooks/..."
              required={overrideNotifications && notifyOnMatch}
              className="block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 text-sm dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none"
            />
          </div>
        )}
      </div>

      <div className="space-y-3 rounded-xl border border-gray-200 bg-white/80 p-4 dark:border-gray-800 dark:bg-gray-950/40">
        <div className="flex items-center justify-between gap-3">
          <div>
            <label
              htmlFor="notifySlack"
              className="text-sm font-medium dark:text-gray-300 text-gray-700"
            >
              Slack notifications
            </label>
            <p className="text-xs dark:text-gray-500 text-gray-600">
              Uses the verified per-filter Slack bot token + channel fields.
            </p>
          </div>
          <input
            type="checkbox"
            id="notifySlack"
            checked={notifySlack}
            onChange={(e) => setNotifySlack(e.target.checked)}
            className="h-4 w-4 rounded dark:border-gray-700 border-gray-300"
          />
        </div>
        {notifySlack && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="filter-slack-bot-token" className="mb-1 block text-xs font-medium dark:text-gray-400 text-gray-700">
                Slack Bot Token *
              </label>
              <input
                id="filter-slack-bot-token"
                value={notifySlackToken}
                onChange={(e) => setNotifySlackToken(e.target.value)}
                placeholder="xoxb-..."
                required={overrideNotifications && notifySlack}
                className="block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 text-sm dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="filter-slack-channel" className="mb-1 block text-xs font-medium dark:text-gray-400 text-gray-700">
                Slack Channel *
              </label>
              <input
                id="filter-slack-channel"
                value={notifySlackChannel}
                onChange={(e) => setNotifySlackChannel(e.target.value)}
                placeholder="#alerts"
                required={overrideNotifications && notifySlack}
                className="block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 text-sm dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface FilterFormProps {
  readonly initial?: Filter;
  readonly instances: Instance[];
  readonly onClose: () => void;
  readonly onSaved: () => void;
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
  const [scriptRuntime, setScriptRuntime] = useState<Filter['script_runtime']>(
    initial?.script_runtime ?? 'shell',
  );
  const [targetPath, setTargetPath] = useState(initial?.target_path ?? '');
  const [instanceId, setInstanceId] = useState<number | undefined>(
    initial?.instance_id ?? (instances.length === 1 ? instances[0].id : undefined),
  );
  const [notifyOnMatch, setNotifyOnMatch] = useState(!!initial?.notify_on_match);
  const [notifyWebhookUrl, setNotifyWebhookUrl] = useState(initial?.notify_webhook_url ?? '');
  const [notifySlack, setNotifySlack] = useState(!!initial?.notify_slack);
  const [notifySlackToken, setNotifySlackToken] = useState(initial?.notify_slack_token ?? '');
  const [notifySlackChannel, setNotifySlackChannel] = useState(initial?.notify_slack_channel ?? '');
  const [overrideNotifications, setOverrideNotifications] = useState(
    initial?.override_notifications === 1,
  );
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

  const validateForm = (
    trimmedTargetPath: string | undefined,
    trimmedWebhookUrl: string | undefined,
    trimmedSlackToken: string | undefined,
    trimmedSlackChannel: string | undefined,
  ): string | null => {
    if (!trimmedTargetPath) return 'Please choose a watched directory for this filter';
    if (!instanceId) return 'Please select an Arr instance';
    if (overrideNotifications && notifyOnMatch && !trimmedWebhookUrl) {
      return 'Please provide a webhook URL or turn off webhook notifications';
    }
    if (overrideNotifications && notifySlack && (!trimmedSlackToken || !trimmedSlackChannel)) {
      return 'Slack notifications require both a bot token and a channel';
    }
    return null;
  };

  const buildNotificationPayload = (
    trimmedWebhookUrl: string | undefined,
    trimmedSlackToken: string | undefined,
    trimmedSlackChannel: string | undefined,
  ): Record<string, unknown> => {
    if (!overrideNotifications) {
      return { overrideNotifications, notifyOnMatch: undefined, notifyWebhookUrl: undefined, notifySlack: undefined, notifySlackToken: undefined, notifySlackChannel: undefined };
    }
    return {
      overrideNotifications,
      notifyOnMatch,
      notifyWebhookUrl: notifyOnMatch ? trimmedWebhookUrl : undefined,
      notifySlack,
      notifySlackToken: notifySlack ? trimmedSlackToken : undefined,
      notifySlackChannel: notifySlack ? trimmedSlackChannel : undefined,
    };
  };

  const handleSubmit = (evt: React.FormEvent) => {
    evt.preventDefault();
    const trimmedTargetPath = trimToUndefined(targetPath);
    const trimmedWebhookUrl = trimToUndefined(notifyWebhookUrl);
    const trimmedSlackToken = trimToUndefined(notifySlackToken);
    const trimmedSlackChannel = trimToUndefined(notifySlackChannel);

    const validationError = validateForm(trimmedTargetPath, trimmedWebhookUrl, trimmedSlackToken, trimmedSlackChannel);
    if (validationError) {
      setErr(validationError);
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
      scriptRuntime,
      targetPath: trimmedTargetPath,
      instanceId,
      ...buildNotificationPayload(trimmedWebhookUrl, trimmedSlackToken, trimmedSlackChannel),
      enabled,
    });
  };

  const isScript = ruleType === 'script';
  const usesScriptRuntime = isScript || actionType === 'script';
  const submitLabel = initial ? 'Update Filter' : 'Create Filter';
  const scriptRuntimeHelpText =
    scriptRuntime === 'shell'
      ? 'Shell scripts execute through bash. Use FILTARR_FILE_* plus FILTARR_CONTEXT_JSON; rule scripts should print true to match.'
      : 'Legacy JavaScript filters run in the sandbox and should use context.file. Use this only when you specifically want the older JS path.';

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

          <div className="space-y-4 rounded-2xl border border-gray-200 bg-gray-50/80 p-4 dark:border-gray-800 dark:bg-gray-900/40">
            <div>
              <h3 className="text-sm font-semibold dark:text-gray-100 text-gray-900">
                Filter basics
              </h3>
              <p className="mt-1 text-xs dark:text-gray-500 text-gray-600">
                Give the filter a name, then point it at the specific directory it should watch.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="filter-name" className="block text-sm font-medium dark:text-gray-400 text-gray-700">
                  Filter Name *
                </label>
                <input
                  id="filter-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="mt-1 block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="filter-description" className="block text-sm font-medium dark:text-gray-400 text-gray-700">
                  Description
                </label>
                <input
                  id="filter-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="mt-1 block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label htmlFor="filter-watched-directory" className="block text-sm font-medium dark:text-gray-400 text-gray-700">
                Watched Directory *
              </label>
              <p className="mb-1 text-xs dark:text-gray-500 text-gray-600">
                This filter only evaluates files inside this path.
              </p>
              <div className="flex gap-2">
                <input
                  id="filter-watched-directory"
                  value={targetPath}
                  onChange={(e) => setTargetPath(e.target.value)}
                  placeholder="/downloads/complete"
                  required
                  className="flex-1 rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 font-mono text-sm dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPicker(true)}
                  className="whitespace-nowrap rounded-lg border dark:border-gray-700 border-gray-300 px-3 py-2 text-sm dark:text-gray-400 text-gray-600 dark:hover:bg-gray-800 hover:bg-gray-100"
                >
                  📁 Browse
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-4 rounded-2xl border border-gray-200 bg-gray-50/80 p-4 dark:border-gray-800 dark:bg-gray-900/40">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="filter-rule-type" className="block text-sm font-medium dark:text-gray-400 text-gray-700">
                  Rule Type
                </label>
                <select
                  id="filter-rule-type"
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
                <label htmlFor="filter-action-type" className="block text-sm font-medium dark:text-gray-400 text-gray-700">
                  Action on Match
                </label>
                <select
                  id="filter-action-type"
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
                    placeholder={SCRIPT_RULE_PLACEHOLDERS[scriptRuntime]}
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
              {usesScriptRuntime && (
                <div className="sm:col-span-2">
                  <label htmlFor="filter-script-runtime" className="block text-sm font-medium dark:text-gray-400 text-gray-700">
                    Script Runtime
                  </label>
                  <select
                    id="filter-script-runtime"
                    value={scriptRuntime}
                    onChange={(e) => setScriptRuntime(e.target.value as Filter['script_runtime'])}
                    className="mt-1 block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none"
                  >
                    {Object.entries(SCRIPT_RUNTIME_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs dark:text-gray-500 text-gray-600">
                    {scriptRuntimeHelpText}
                  </p>
                </div>
              )}
              {(actionType === 'move' || actionType === 'script') && (
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium dark:text-gray-400 text-gray-700">
                    {actionType === 'move' ? 'Destination Path' : 'Script Payload'}
                  </label>
                  {actionType === 'script' ? (
                    <textarea
                      value={actionPayload}
                      onChange={(e) => setActionPayload(e.target.value)}
                      rows={5}
                      placeholder={SCRIPT_ACTION_PLACEHOLDERS[scriptRuntime]}
                      className="mt-1 block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 font-mono text-sm dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none"
                    />
                  ) : (
                    <input
                      value={actionPayload}
                      onChange={(e) => setActionPayload(e.target.value)}
                      placeholder="/mnt/quarantine"
                      className="mt-1 block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none"
                    />
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4 rounded-2xl border border-gray-200 bg-gray-50/80 p-4 dark:border-gray-800 dark:bg-gray-900/40">
            <div>
              <h3 className="text-sm font-semibold dark:text-gray-100 text-gray-900">
                Instance and notifications
              </h3>
              <p className="mt-1 text-xs dark:text-gray-500 text-gray-600">
                Filters inherit the global notification defaults unless you explicitly override
                them here.
              </p>
            </div>

            <div>
              <label htmlFor="filter-arr-instance" className="block text-sm font-medium dark:text-gray-400 text-gray-700">
                Arr Instance *
              </label>
              <p className="mb-2 text-xs dark:text-gray-500 text-gray-600">
                Which Arr instance should this filter act on?
              </p>
              {instances.length === 0 ? (
                <p className="text-sm italic dark:text-gray-500 text-gray-600">
                  No instances configured yet.
                </p>
              ) : (
                <select
                  id="filter-arr-instance"
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

            <div className="space-y-3 rounded-xl border border-gray-200 bg-white/80 p-4 dark:border-gray-800 dark:bg-gray-950/40">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="overrideNotifications"
                  checked={overrideNotifications}
                  onChange={(e) => setOverrideNotifications(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded dark:border-gray-700 border-gray-300"
                />
                <div>
                  <label
                    htmlFor="overrideNotifications"
                    className="text-sm font-medium dark:text-gray-300 text-gray-700"
                  >
                    Override notification defaults for this filter
                  </label>
                  <p className="mt-1 text-xs dark:text-gray-500 text-gray-600">
                    Leave this off to inherit the default webhook and Slack settings from the
                    Settings page.
                  </p>
                </div>
              </div>

              <NotificationOverrideFields
                overrideNotifications={overrideNotifications}
                notifyOnMatch={notifyOnMatch}
                setNotifyOnMatch={setNotifyOnMatch}
                notifyWebhookUrl={notifyWebhookUrl}
                setNotifyWebhookUrl={setNotifyWebhookUrl}
                notifySlack={notifySlack}
                setNotifySlack={setNotifySlack}
                notifySlackToken={notifySlackToken}
                setNotifySlackToken={setNotifySlackToken}
                notifySlackChannel={notifySlackChannel}
                setNotifySlackChannel={setNotifySlackChannel}
              />
            </div>
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
              {mutation.isPending ? 'Saving...' : submitLabel}
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
  readonly filter: Filter;
  readonly instances: Instance[];
  readonly notificationSettings?: NotificationSettingsResponse;
  readonly onEdit: () => void;
  readonly onToggle: () => void;
  readonly onDelete: (() => void) | null;
}

function FilterCard({
  filter: f,
  instances,
  notificationSettings,
  onEdit,
  onToggle,
  onDelete,
}: FilterCardProps) {
  const linkedInstance = instances.find((i) => i.id === f.instance_id);
  const notificationChannels = getFilterNotificationChannels(f, notificationSettings);
  const pathConfigured = hasConfiguredPath(f.target_path);
  const usesScriptRuntime = f.rule_type === 'script' || f.action_type === 'script';

  return (
    <div className={FILTER_CARD_CLASS_NAME}>
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
              {usesScriptRuntime && (
                <span>
                  <span className="dark:text-gray-500 text-gray-500">Runtime:</span>{' '}
                  {SCRIPT_RUNTIME_LABELS[f.script_runtime]}
                </span>
              )}
            </div>
            <div className="mt-3 grid gap-2 lg:grid-cols-2">
              <div className="rounded-xl border border-gray-200 bg-gray-50/80 px-3 py-2 dark:border-gray-800 dark:bg-gray-950/40">
                <div className="text-[11px] font-semibold uppercase tracking-wide dark:text-gray-500 text-gray-500">
                  Watched directory
                </div>
                <div
                  className={`mt-1 break-all font-mono text-xs ${
                    pathConfigured ? 'dark:text-gray-200 text-gray-800' : 'dark:text-amber-300 text-amber-700'
                  }`}
                >
                  {pathConfigured ? f.target_path : 'Path required before watcher runs this filter'}
                </div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50/80 px-3 py-2 dark:border-gray-800 dark:bg-gray-950/40">
                <div className="text-[11px] font-semibold uppercase tracking-wide dark:text-gray-500 text-gray-500">
                  Notifications
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {notificationChannels.length > 0 ? (
                    notificationChannels.map((channel) => (
                      <span
                        key={channel.key}
                        title={channel.detail}
                        className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-[11px] font-medium text-blue-600 dark:text-blue-300"
                      >
                        {channel.label}
                        {channel.detail ? ` · ${channel.detail}` : ''}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs dark:text-gray-500 text-gray-600">Disabled</span>
                  )}
                </div>
              </div>
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
  const [deleting, setDeleting] = useState<Filter | null>(null);

  const { data: filters = [], isLoading } = useQuery<Filter[]>({
    queryKey: ['filters'],
    queryFn: () => api.get('/filters'),
  });

  const { data: instances = [] } = useQuery<Instance[]>({
    queryKey: ['instances'],
    queryFn: () => api.get('/instances'),
  });

  const { data: notificationSettings } = useQuery<NotificationSettingsResponse>({
    queryKey: ['settings', 'notifications'],
    queryFn: () => api.get('/settings/notifications'),
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

  const isEditorModalOpen = showForm || editing !== null;

  const closeEditorModal = () => {
    setShowForm(false);
    setEditing(null);
  };

  const handleConfirmDelete = () => {
    if (!deleting) return;

    deleteMutation.mutate(deleting.id, {
      onSuccess: () => setDeleting(null),
    });
  };

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
            Each filter owns its <strong>watched directory</strong> and linked <strong>Arr
            instance</strong>. Notifications inherit the <strong>Settings</strong> defaults unless
            you enable a per-filter override.
          </p>
        </div>
      </div>

      <Modal
        title={editing ? 'Edit Filter' : 'Add Filter'}
        isOpen={isEditorModalOpen}
        onClose={closeEditorModal}
      >
        <FilterForm
          initial={editing ?? undefined}
          instances={instances}
          onClose={closeEditorModal}
          onSaved={closeEditorModal}
        />
      </Modal>

      <Modal title="Delete Filter" isOpen={deleting !== null} onClose={() => setDeleting(null)}>
        {deleting && (
          <div className="space-y-5">
            <div className="rounded-2xl border border-red-200 bg-red-50/70 p-4 dark:border-red-900/50 dark:bg-red-950/30">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                Are you sure you want to delete{' '}
                <span className="font-semibold text-red-600 dark:text-red-300">“{deleting.name}”</span>
                ?
              </p>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                This will permanently remove the filter configuration and cannot be undone.
              </p>
            </div>

            <div className="flex justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setDeleting(null)}
                disabled={deleteMutation.isPending}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleteMutation.isPending}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete Filter'}
              </button>
            </div>
          </div>
        )}
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
                  notificationSettings={notificationSettings}
                  onEdit={() => setEditing(f)}
                  onToggle={() => toggleMutation.mutate({ id: f.id, enabled: !f.enabled })}
                  onDelete={canDeleteFilter(f) ? () => setDeleting(f) : null}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
