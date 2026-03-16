import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../components/ui';
import { api } from '../lib/api';

interface ActivityEvent {
  id: number;
  type: string;
  source: string;
  message: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

const TYPE_META: Record<string, { label: string; className: string }> = {
  created: { label: 'Created', className: 'bg-green-500/15 text-green-700 dark:text-green-300' },
  updated: { label: 'Updated', className: 'bg-blue-500/15 text-blue-700 dark:text-blue-300' },
  deleted: { label: 'Deleted', className: 'bg-red-500/15 text-red-700 dark:text-red-300' },
  matched: { label: 'Match', className: 'bg-purple-500/15 text-purple-700 dark:text-purple-300' },
  action: { label: 'Action', className: 'bg-orange-500/15 text-orange-700 dark:text-orange-300' },
  notification: { label: 'Notification', className: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300' },
  run: { label: 'Job run', className: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300' },
  validation: { label: 'Validation', className: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-300' },
  started: { label: 'Started', className: 'bg-gray-500/15 text-gray-700 dark:text-gray-300' },
};

const SOURCE_LABELS: Record<string, string> = {
  filters: 'Filters',
  jobs: 'Scheduler',
  instances: 'Instances',
  directories: 'Paths',
  settings: 'Settings',
  system: 'System',
};

const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function prettifyKey(key: string): string {
  return key
    .replaceAll(/([A-Z])/g, ' $1')
    .replaceAll(/[_-]/g, ' ')
    .replace(/^./, (value) => value.toUpperCase());
}

function formatDetailValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return value.toLocaleString();
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function isFailure(event: ActivityEvent): boolean {
  return event.details?.['status'] === 'failure' || event.details?.['success'] === false;
}

export default function Activity() {
  const [selectedType, setSelectedType] = useState('all');
  const [selectedSource, setSelectedSource] = useState('all');

  const {
    data: events = [],
    isLoading,
    error,
    refetch,
  } = useQuery<ActivityEvent[]>({
    queryKey: ['events', 'timeline'],
    queryFn: () => api.get('/events?limit=100'),
  });

  const sourceOptions = useMemo(
    () => Array.from(new Set(events.map((event) => event.source))).sort((a, b) => a.localeCompare(b)),
    [events],
  );
  const typeOptions = useMemo(
    () => Array.from(new Set(events.map((event) => event.type))).sort((a, b) => a.localeCompare(b)),
    [events],
  );

  const filteredEvents = useMemo(
    () =>
      events.filter((event) => {
        const matchesType = selectedType === 'all' || event.type === selectedType;
        const matchesSource = selectedSource === 'all' || event.source === selectedSource;
        return matchesType && matchesSource;
      }),
    [events, selectedSource, selectedType],
  );

  const summary = useMemo(() => {
    const failures = events.filter(isFailure).length;
    const filterMatches = events.filter((event) => event.type === 'matched').length;
    const validations = events.filter((event) => event.type === 'validation').length;

    return {
      total: events.length,
      failures,
      filterMatches,
      validations,
    };
  }, [events]);

  const activityErrorMessage =
    error instanceof Error
      ? error.message
      : 'Try refreshing the timeline to load the latest activity.';

  let timelineContent: React.ReactNode;
  if (isLoading) {
    timelineContent = (
      <div className="mt-6 rounded-2xl border border-dashed border-gray-300 px-6 py-12 text-center text-sm text-gray-500 dark:border-gray-700">
        Loading activity…
      </div>
    );
  } else if (error) {
    timelineContent = (
      <div className="mt-6 rounded-3xl border border-dashed border-gray-300 px-6 py-12 text-center dark:border-gray-700">
        <h4 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Unable to load activity</h4>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-500">{activityErrorMessage}</p>
        <div className="mt-4">
          <Button onClick={() => refetch()} variant="secondary">
            Retry timeline
          </Button>
        </div>
      </div>
    );
  } else if (filteredEvents.length > 0) {
    timelineContent = (
      <div className="mt-6 space-y-4">
        {filteredEvents.map((event) => {
          const typeMeta = TYPE_META[event.type] || {
            label: prettifyKey(event.type),
            className: 'bg-gray-500/15 text-gray-700 dark:text-gray-300',
          };
          const detailEntries = Object.entries(event.details || {}).filter(
            ([, value]) => value !== undefined && value !== null && value !== '',
          );

          return (
            <div
              key={event.id}
              className="rounded-2xl border border-gray-200 bg-gray-50/60 p-5 dark:border-gray-800 dark:bg-gray-950/30"
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${typeMeta.className}`}
                    >
                      {typeMeta.label}
                    </span>
                    <span className="rounded-full bg-gray-200 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                      {SOURCE_LABELS[event.source] || event.source}
                    </span>
                  </div>
                  <p className="mt-3 text-sm font-medium text-gray-900 dark:text-gray-100">{event.message}</p>
                </div>
                <p className="text-xs text-gray-500">{timestampFormatter.format(new Date(event.createdAt))}</p>
              </div>

              {detailEntries.length > 0 && (
                <dl className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {detailEntries.map(([key, value]) => (
                    <div
                      key={`${event.id}-${key}`}
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900"
                    >
                      <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                        {prettifyKey(key)}
                      </dt>
                      <dd className="mt-1 break-all text-sm text-gray-700 dark:text-gray-300">
                        {formatDetailValue(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          );
        })}
      </div>
    );
  } else if (events.length === 0) {
    timelineContent = (
      <div className="mt-6 rounded-3xl border border-dashed border-gray-300 px-6 py-12 text-center dark:border-gray-700">
        <h4 className="text-lg font-semibold text-gray-900 dark:text-gray-100">No activity yet</h4>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-500">
          Activity will appear here after filters run, jobs execute, instance checks happen, or settings are changed.
        </p>
      </div>
    );
  } else {
    timelineContent = (
      <div className="mt-6 rounded-3xl border border-dashed border-gray-300 px-6 py-12 text-center dark:border-gray-700">
        <h4 className="text-lg font-semibold text-gray-900 dark:text-gray-100">No events match the current filters</h4>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-500">
          Reset the filters above to see the full timeline again.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Activity</h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-600 dark:text-gray-500">
            Review what Filtarr has done across filters, scheduled jobs, connection checks, and
            configuration changes.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/filters"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Review filters
          </Link>
          <Link
            to="/scheduler"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Review scheduler
          </Link>
          <Link
            to="/settings"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            Review settings
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <p className="text-sm text-gray-500">Events loaded</p>
          <p className="mt-2 text-3xl font-semibold text-gray-900 dark:text-gray-100">{summary.total}</p>
          <p className="mt-1 text-xs text-gray-500">Latest 100 activity records</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <p className="text-sm text-gray-500">Failures spotted</p>
          <p className="mt-2 text-3xl font-semibold text-red-600 dark:text-red-400">{summary.failures}</p>
          <p className="mt-1 text-xs text-gray-500">Failed runs, notifications, or validations</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <p className="text-sm text-gray-500">Filter matches</p>
          <p className="mt-2 text-3xl font-semibold text-purple-600 dark:text-purple-400">
            {summary.filterMatches}
          </p>
          <p className="mt-1 text-xs text-gray-500">Files that matched an active rule</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <p className="text-sm text-gray-500">Instance validations</p>
          <p className="mt-2 text-3xl font-semibold text-yellow-600 dark:text-yellow-400">
            {summary.validations}
          </p>
          <p className="mt-1 text-xs text-gray-500">Manual and scheduled connectivity checks</p>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Timeline</h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-500">
              Filter by event type or source to narrow down the latest activity.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="text-sm text-gray-600 dark:text-gray-400">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
                Type
              </span>
              <select
                value={selectedType}
                onChange={(event) => setSelectedType(event.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="all">All types</option>
                {typeOptions.map((type) => (
                  <option key={type} value={type}>
                    {TYPE_META[type]?.label || type}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm text-gray-600 dark:text-gray-400">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
                Source
              </span>
              <select
                value={selectedSource}
                onChange={(event) => setSelectedSource(event.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="all">All sources</option>
                {sourceOptions.map((source) => (
                  <option key={source} value={source}>
                    {SOURCE_LABELS[source] || source}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={() => {
                setSelectedType('all');
                setSelectedSource('all');
              }}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Reset filters
            </button>
          </div>
        </div>

        <p className="mt-4 text-sm text-gray-500">
          Showing {filteredEvents.length} of {events.length} events.
        </p>

        {timelineContent}
      </div>
    </div>
  );
}
