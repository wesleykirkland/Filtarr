import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { toast } from '../components/Toast';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';
import {
  getWatcherAutomationDeletePatch,
  shouldPromptForWatcherAutomation,
  supportsWatcherAutomation,
} from '../lib/schedulerUi';

interface Filter {
  id: number;
  name: string;
  description?: string | null;
  is_built_in: number;
  target_path?: string | null;
  action_type: string;
  trigger_source: 'watcher' | 'cron' | 'manual';
  enabled: number;
}

interface Job {
  id: number;
  name: string;
  description?: string;
  schedule: string;
  type: string;
  payload?: string; // JSON: { filterId: number }
  enabled: boolean;
  lastRunAt?: string;
  lastRunStatus?: 'success' | 'failure' | 'running';
  createdAt: string;
}

const CRON_PRESETS = [
  { label: 'Every 5 minutes', value: '*/5 * * * *' },
  { label: 'Every 15 minutes', value: '*/15 * * * *' },
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Daily at midnight', value: '0 0 * * *' },
  { label: 'Weekly on Sunday', value: '0 0 * * 0' },
];

type AutomationMode = 'cron' | 'watcher';

interface SaveAutomationResult {
  mode: AutomationMode;
  deletedJobs: number;
}

function getFilterId(job: Job): number | null {
  try {
    if (!job.payload) return null;
    const parsed = JSON.parse(job.payload) as { filterId?: number };
    return parsed.filterId ?? null;
  } catch {
    return null;
  }
}

interface JobFormProps {
  initialJob?: Job;
  initialWatcherFilter?: Filter;
  filters: Filter[];
  jobs: Job[];
  onClose: () => void;
  onSaved: () => void;
}

function JobForm({ initialJob, initialWatcherFilter, filters, jobs, onClose, onSaved }: JobFormProps) {
  const initialFilterId = initialJob ? getFilterId(initialJob) : (initialWatcherFilter?.id ?? null);
  const initialFilter =
    initialWatcherFilter ??
    (initialFilterId ? filters.find((filter) => filter.id === initialFilterId) : filters[0]);
  const isEditing = Boolean(initialJob || initialWatcherFilter);

  const [name, setName] = useState(initialJob?.name ?? '');
  const [description, setDescription] = useState(initialJob?.description ?? '');
  const [schedule, setSchedule] = useState(initialJob?.schedule ?? '0 * * * *');
  const [filterId, setFilterId] = useState<number | ''>(initialFilterId ?? filters[0]?.id ?? '');
  const [automationMode, setAutomationMode] = useState<AutomationMode>(initialWatcherFilter ? 'watcher' : 'cron');
  const [enabled, setEnabled] = useState(
    initialJob ? Boolean(initialJob.enabled) : initialFilter ? initialFilter.enabled === 1 : true,
  );
  const [err, setErr] = useState('');
  const [watcherPromptFilterId, setWatcherPromptFilterId] = useState<number | null>(null);
  const [promptedFilterIds, setPromptedFilterIds] = useState<number[]>([]);

  const selectedFilter = filters.find((f) => f.id === filterId);
  const watcherPromptOpen =
    watcherPromptFilterId === selectedFilter?.id &&
    automationMode === 'cron' &&
    !isEditing &&
    selectedFilter !== undefined &&
    selectedFilter.trigger_source !== 'watcher' &&
    supportsWatcherAutomation(selectedFilter);

  useEffect(() => {
    if (!selectedFilter) return;

    if (
      shouldPromptForWatcherAutomation({
        filter: selectedFilter,
        automationMode,
        isEditing,
        hasPromptedForFilter: promptedFilterIds.includes(selectedFilter.id),
      })
    ) {
      setWatcherPromptFilterId(selectedFilter.id);
      setPromptedFilterIds((current) => [...current, selectedFilter.id]);
    }
  }, [selectedFilter, automationMode, isEditing, promptedFilterIds]);

  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (): Promise<SaveAutomationResult> => {
      if (!filterId) throw new Error('Please select a filter');
      if (!selectedFilter) throw new Error('Selected filter no longer exists');

      if (automationMode === 'watcher') {
        if (!selectedFilter.target_path?.trim()) {
          throw new Error('Built-in watcher requires the selected filter to have a target path');
        }

        await api.put(`/filters/${selectedFilter.id}`, {
          triggerSource: 'watcher',
          enabled,
        });

        const jobsToDelete = new Map<number, Job>();
        if (initialJob) jobsToDelete.set(initialJob.id, initialJob);

        for (const job of jobs) {
          if (getFilterId(job) === selectedFilter.id) {
            jobsToDelete.set(job.id, job);
          }
        }

        await Promise.all([...jobsToDelete.keys()].map((jobId) => api.delete(`/jobs/${jobId}`)));

        return { mode: 'watcher', deletedJobs: jobsToDelete.size };
      }

      await api.put(`/filters/${selectedFilter.id}`, { triggerSource: 'cron' });

      const body = {
        name: name || selectedFilter.name || 'Scheduled filter run',
        description: description || undefined,
        schedule,
        type: 'filter_run',
        payload: JSON.stringify({ filterId: selectedFilter.id }),
        enabled,
      };

      if (initialJob) {
        await api.put(`/jobs/${initialJob.id}`, body);
      } else {
        await api.post('/jobs', body);
      }

      return { mode: 'cron', deletedJobs: 0 };
    },
    onSuccess: ({ mode, deletedJobs }) => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      queryClient.invalidateQueries({ queryKey: ['filters'] });

      if (mode === 'watcher') {
        toast(
          'success',
          deletedJobs > 0
            ? `Watcher automation saved and ${deletedJobs} scheduled job${deletedJobs === 1 ? '' : 's'} removed`
            : 'Watcher automation saved',
        );
      } else {
        toast('success', isEditing ? 'Automation updated' : 'Job created');
      }

      onSaved();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const handleSubmit = (evt: React.FormEvent) => {
    evt.preventDefault();
    setErr('');
    if (!filterId) {
      setErr('Please select a filter');
      return;
    }

    mutation.mutate();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <ConfirmModal
        isOpen={watcherPromptOpen}
        title="Create watcher automation instead?"
        message={`"${selectedFilter?.name ?? 'This filter'}" already has a target path, so Filtarr can run it automatically with the built-in file system watcher. Switch this automation to watcher mode instead of creating a cron schedule?`}
        confirmLabel="Use Watcher"
        cancelLabel="Keep Cron"
        onConfirm={() => setAutomationMode('watcher')}
        onClose={() => setWatcherPromptFilterId(null)}
      />

      {err && (
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {err}
        </div>
      )}

      {/* Filter selection */}
      <div>
        <label className="block text-sm font-medium dark:text-gray-400 text-gray-700">
          Filter to Run *
        </label>
        <p className="text-xs dark:text-gray-500 text-gray-600 mb-1">
          Choose which filter this job will execute on its schedule.
        </p>
        {filters.length === 0 ? (
          <div className="rounded-lg border dark:border-yellow-800/50 border-yellow-200 dark:bg-yellow-900/20 bg-yellow-50 px-4 py-3 text-sm dark:text-yellow-300 text-yellow-700">
            No filters configured yet.{' '}
            <a href="/filters" className="underline">
              Create a filter first
            </a>
            .
          </div>
        ) : (
          <div className="mt-1 space-y-2">
            {filters.map((f) => (
              <label
                key={f.id}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${filterId === f.id ? 'border-blue-500 dark:bg-blue-500/10 bg-blue-50' : 'dark:border-gray-700 border-gray-300 dark:hover:bg-gray-800/50 hover:bg-gray-50'}`}
              >
                <input
                  type="radio"
                  name="filterId"
                  value={f.id}
                  checked={filterId === f.id}
                  onChange={() => setFilterId(f.id)}
                  className="mt-0.5"
                />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium dark:text-gray-100 text-gray-900 text-sm">
                      {f.name}
                    </span>
                    {!!f.is_built_in && (
                      <span className="rounded bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 text-[10px] font-medium uppercase">
                        Built-in
                      </span>
                    )}
                  </div>
                  {f.description && (
                    <div className="text-xs dark:text-gray-500 text-gray-600 mt-0.5">
                      {f.description}
                    </div>
                  )}
                  {f.target_path && (
                    <div className="text-xs font-mono dark:text-gray-500 text-gray-600 mt-0.5">
                      {f.target_path}
                    </div>
                  )}
                </div>
              </label>
            ))}
          </div>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium dark:text-gray-400 text-gray-700">
          Automation Mode
        </label>
        <div className="mt-1 space-y-2">
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${automationMode === 'cron' ? 'border-blue-500 dark:bg-blue-500/10 bg-blue-50' : 'dark:border-gray-700 border-gray-300 dark:hover:bg-gray-800/50 hover:bg-gray-50'}`}
          >
            <input
              type="radio"
              name="automationMode"
              checked={automationMode === 'cron'}
              onChange={() => setAutomationMode('cron')}
              className="mt-0.5"
            />
            <div>
              <div className="text-sm font-medium dark:text-gray-100 text-gray-900">
                Cron schedule
              </div>
              <div className="text-xs dark:text-gray-500 text-gray-600">
                Runs the selected filter on the configured cron interval.
              </div>
            </div>
          </label>
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${automationMode === 'watcher' ? 'border-blue-500 dark:bg-blue-500/10 bg-blue-50' : 'dark:border-gray-700 border-gray-300 dark:hover:bg-gray-800/50 hover:bg-gray-50'}`}
          >
            <input
              type="radio"
              name="automationMode"
              checked={automationMode === 'watcher'}
              onChange={() => setAutomationMode('watcher')}
              className="mt-0.5"
            />
            <div>
              <div className="text-sm font-medium dark:text-gray-100 text-gray-900">
                Built-in file system watcher
              </div>
              <div className="text-xs dark:text-gray-500 text-gray-600">
                Watches the filter target path and runs automatically on file add/change events.
              </div>
            </div>
          </label>
        </div>
      </div>

      {selectedFilter && automationMode === 'cron' && (
        <div>
          <label className="block text-sm font-medium dark:text-gray-400 text-gray-700">
            Job Name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`Run: ${selectedFilter.name}`}
            className="mt-1 block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none"
          />
        </div>
      )}

      {automationMode === 'cron' && (
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
      )}

      {automationMode === 'cron' ? (
        <div>
          <label className="block text-sm font-medium dark:text-gray-400 text-gray-700">
            Cron Schedule *
          </label>
          <div className="mt-1 flex gap-2">
            <input
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              required={automationMode === 'cron'}
              className="block flex-1 rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 font-mono dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none"
            />
            <select
              onChange={(e) => {
                if (e.target.value) setSchedule(e.target.value);
              }}
              defaultValue=""
              className="rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 text-sm dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none"
            >
              <option value="">Presets…</option>
              {CRON_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <p className="mt-1 text-xs dark:text-gray-500 text-gray-600">
            Format: minute hour day-of-month month day-of-week
          </p>
        </div>
      ) : (
        <div className="rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800/50 bg-gray-50 px-4 py-3 text-sm dark:text-gray-300 text-gray-700">
          <p>
            The built-in watcher uses the filter&apos;s configured target path and runs automatically
            when files are added or changed.
          </p>
          {!selectedFilter?.target_path && (
            <p className="mt-2 text-xs dark:text-yellow-400 text-yellow-600">
              Add a target path on the Filters page before enabling watcher automation.
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <input
          type="checkbox"
          id="jobEnabled"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4 rounded dark:border-gray-700 border-gray-300"
        />
        <label
          htmlFor="jobEnabled"
          className="text-sm font-medium dark:text-gray-400 text-gray-600"
        >
          {automationMode === 'watcher' ? 'Watcher enabled' : 'Job enabled'}
        </label>
      </div>

      {automationMode === 'cron' && selectedFilter?.enabled !== 1 && (
        <p className="text-xs dark:text-yellow-400 text-yellow-600">
          This filter is currently disabled. Cron runs will only execute after the filter is re-enabled.
        </p>
      )}

      <div className="flex gap-2 border-t dark:border-gray-800 border-gray-200 pt-4">
        <button
          type="submit"
          disabled={mutation.isPending || !filterId}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {mutation.isPending
            ? 'Saving...'
            : automationMode === 'watcher'
              ? 'Save Watcher'
              : isEditing
                ? 'Update Automation'
                : 'Schedule Job'}
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
  );
}

function statusBadge(status?: Job['lastRunStatus']) {
  if (!status) return null;
  const map = {
    success: 'bg-green-500/20 text-green-400',
    failure: 'bg-red-500/20 text-red-400',
    running: 'bg-yellow-500/20 text-yellow-400 animate-pulse',
  };
  return (
    <span className={`rounded px-2 py-0.5 text-[11px] font-medium uppercase ${map[status]}`}>
      {status}
    </span>
  );
}

export default function Scheduler() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Job | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Job | null>(null);

  const { data: rawJobs, isLoading } = useQuery<Job[]>({
    queryKey: ['jobs'],
    queryFn: () => api.get('/jobs'),
  });

  const { data: rawFilters } = useQuery<Filter[]>({
    queryKey: ['filters'],
    queryFn: () => api.get('/filters'),
  });

  const filters = rawFilters ?? [];
  const jobs = rawJobs ?? [];
  const watcherFilters = filters.filter((filter) => filter.trigger_source === 'watcher');

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      api.put(`/jobs/${id}`, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['jobs'] }),
  });

  const toggleWatcherMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => api.put(`/filters/${id}`, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['filters'] }),
    onError: (e: Error) => toast('error', e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/jobs/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      setPendingDelete(null);
      toast('success', 'Job deleted');
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const deleteWatcherMutation = useMutation({
    mutationFn: (id: number) => api.put(`/filters/${id}`, getWatcherAutomationDeletePatch()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['filters'] });
      toast('success', 'Watcher automation deleted');
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const isModalOpen = showForm || editing !== null || editingWatcher !== null;

  function closeAutomationModal() {
    setShowForm(false);
    setEditing(null);
    setEditingWatcher(null);
  }

  function filterForJob(job: Job): Filter | undefined {
    const fid = getFilterId(job);
    return fid ? filters.find((f) => f.id === fid) : undefined;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold dark:text-gray-100 text-gray-900">Scheduler</h2>
          <p className="mt-1 text-sm dark:text-gray-500 text-gray-600">
            Run filters either on a cron interval or with the built-in file system watcher.
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + Add Automation
        </button>
      </div>

      <Modal
        title={editing || editingWatcher ? 'Edit Automation' : 'Schedule a Filter'}
        isOpen={isModalOpen}
        onClose={closeAutomationModal}
      >
        <JobForm
          initialJob={editing ?? undefined}
          initialWatcherFilter={editingWatcher ?? undefined}
          filters={filters}
          jobs={jobs}
          onClose={closeAutomationModal}
          onSaved={closeAutomationModal}
        />
      </Modal>

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        title="Delete scheduled job?"
        description={
          pendingDelete
            ? <>Delete <span className="font-medium text-gray-900 dark:text-gray-100">{pendingDelete.name}</span>? Future scheduled runs will stop immediately.</>
            : ''
        }
        confirmLabel="Delete job"
        isPending={deleteMutation.isPending}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
      />

      {isLoading ? (
        <p className="dark:text-gray-400 text-gray-500">Loading jobs...</p>
      ) : jobs.length > 0 ? (
        <div className="space-y-3">
          {jobs.map((job) => {
            const linkedFilter = filterForJob(job);
            return (
              <div
                key={job.id}
                className="rounded-xl border dark:border-gray-800 border-gray-200 dark:bg-gray-900 bg-white shadow-sm px-6 py-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <button
                      onClick={() => toggleMutation.mutate({ id: job.id, enabled: !job.enabled })}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${job.enabled ? 'bg-blue-600' : 'dark:bg-gray-700 bg-gray-300'}`}
                    >
                      <span
                        className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${job.enabled ? 'translate-x-4' : 'translate-x-0'}`}
                      />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold dark:text-gray-100 text-gray-900">
                          {job.name}
                        </h3>
                        {statusBadge(job.lastRunStatus)}
                      </div>
                      {linkedFilter && (
                        <p className="mt-0.5 text-sm dark:text-gray-500 text-gray-600">
                          Runs filter:{' '}
                          <span className="dark:text-gray-300 text-gray-700 font-medium">
                            {linkedFilter.name}
                          </span>
                          {linkedFilter.target_path && (
                            <span className="ml-2 font-mono text-xs dark:text-gray-500 text-gray-500">
                              {linkedFilter.target_path}
                            </span>
                          )}
                        </p>
                      )}
                      <div className="mt-1 flex items-center gap-3 text-xs dark:text-gray-400 text-gray-600">
                        <span className="font-mono dark:bg-gray-800 bg-gray-100 px-1.5 py-0.5 rounded">
                          {job.schedule}
                        </span>
                        {job.lastRunAt && (
                          <span>Last run: {new Date(job.lastRunAt).toLocaleString()}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => setEditing(job)}
                      className="rounded-lg border dark:border-gray-700 border-gray-300 px-3 py-1.5 text-xs font-medium dark:text-gray-400 text-gray-700 dark:hover:bg-gray-800 hover:bg-gray-100"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setPendingDelete(job)}
                      className="rounded-lg border dark:border-red-900 border-red-200 px-3 py-1.5 text-xs font-medium dark:text-red-400 text-red-600 dark:hover:bg-red-900/30 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border dark:border-gray-800 border-gray-200 dark:bg-gray-900 bg-white shadow-sm p-12 text-center">
          <span className="text-5xl">⏰</span>
          <h3 className="mt-4 text-lg font-semibold dark:text-gray-300 text-gray-700">
            No scheduled jobs
          </h3>
          <p className="mt-2 dark:text-gray-500 text-gray-600 max-w-md mx-auto">
            Add a cron schedule here when you want a filter to run periodically instead of using the built-in watcher.
          </p>
          {filters.length === 0 ? (
            <p className="mt-3 text-sm dark:text-yellow-400 text-yellow-600">
              You need to{' '}
              <a href="/filters" className="underline">
                create a filter
              </a>{' '}
              before scheduling it.
            </p>
          ) : (
            <button
              onClick={() => setShowForm(true)}
              className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Add First Automation
            </button>
          )}
        </div>
      )}

      <ConfirmModal
        isOpen={deletingWatcher !== null}
        title="Delete watcher automation"
        message={`Stop automatically watching "${deletingWatcher?.name ?? 'this filter'}"? The filter will stay available for manual runs or a future cron schedule.`}
        confirmLabel="Delete"
        isDestructive={true}
        onConfirm={() => deletingWatcher && deleteWatcherMutation.mutate(deletingWatcher.id)}
        onClose={() => setDeletingWatcher(null)}
      />
    </div>
  );
}
