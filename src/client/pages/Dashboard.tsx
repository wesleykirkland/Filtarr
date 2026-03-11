import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, EmptyState, PageHeader, buttonStyles, cn } from '../components/ui';
import { FolderIcon, PlusIcon, SparklesIcon } from '../components/Icons';
import { api } from '../lib/api';
import { useInstances } from '../hooks/useInstances';
import { buildDashboardSummary } from '../lib/dashboard';

interface HealthResponse {
  status: string;
  version: string;
}

interface FilterSummary {
  enabled: number;
  target_path?: string | null;
}

interface JobSummary {
  enabled: boolean;
}

export default function Dashboard() {
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<HealthResponse>('/health'),
  });

  const { data: instances = [], isLoading: instancesLoading, error: instancesError } = useInstances();
  const {
    data: filters = [],
    isLoading: filtersLoading,
    error: filtersError,
  } = useQuery<FilterSummary[]>({
    queryKey: ['filters'],
    queryFn: () => api.get('/filters'),
  });
  const {
    data: jobs = [],
    isLoading: jobsLoading,
    error: jobsError,
  } = useQuery<JobSummary[]>({
    queryKey: ['jobs'],
    queryFn: () => api.get('/jobs'),
  });

  const isAutomationSummaryLoading = instancesLoading || filtersLoading || jobsLoading;
  const automationSummaryError = instancesError || filtersError || jobsError;
  const summary = buildDashboardSummary({ instances, filters, jobs });
  const readinessAccent = summary.automationReady ? 'success' : 'info';
  const automationSummaryErrorMessage =
    automationSummaryError instanceof Error
      ? automationSummaryError.message
      : 'Try refreshing the page to load the latest connections and schedules.';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="A quick picture of what is connected, what is active, and the next step to get reliable automation running."
        actions={
          <>
            <Link to="/instances" className={buttonStyles({ variant: 'secondary' })}>
              Manage instances
            </Link>
            <Link to="/filters" className={buttonStyles()}>
              <PlusIcon className="h-4 w-4" />
              Create automation
            </Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <h3 className="text-sm font-medium text-gray-500">System status</h3>
          <div className="mt-2 flex items-center gap-2">
            <span
              className={`h-3 w-3 rounded-full ${health?.status === 'ok' ? 'bg-green-500' : 'bg-red-500'}`}
            />
            <span className="text-lg font-semibold capitalize text-gray-900 dark:text-gray-100">
              {health?.status ?? 'Unknown'}
            </span>
          </div>
          {health?.version && (
            <p className="mt-1 text-sm text-gray-500">v{health.version}</p>
          )}
        </Card>

        {isAutomationSummaryLoading ? (
          <Card className="sm:col-span-1 xl:col-span-3">
            <h3 className="text-sm font-medium text-gray-500">Automation summary</h3>
            <p className="mt-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
              Loading dashboard data…
            </p>
            <p className="mt-1 text-sm text-gray-500">
              Pulling the latest instances, filters, and schedules before showing recommendations.
            </p>
          </Card>
        ) : automationSummaryError ? (
          <Card className="sm:col-span-1 xl:col-span-3">
            <h3 className="text-sm font-medium text-gray-500">Automation summary</h3>
            <p className="mt-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
              Unable to load dashboard data
            </p>
            <p className="mt-1 text-sm text-gray-500">{automationSummaryErrorMessage}</p>
          </Card>
        ) : (
          <>
            <Card>
              <h3 className="text-sm font-medium text-gray-500">Connected instances</h3>
              <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-gray-100">{summary.instanceCount}</p>
              <p className="mt-1 text-sm text-gray-500">{summary.activeInstanceCount} active</p>
            </Card>

            <Card>
              <h3 className="text-sm font-medium text-gray-500">Filters ready</h3>
              <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-gray-100">{summary.activeFilterCount}</p>
              <p className="mt-1 text-sm text-gray-500">
                {summary.filterCount} total · {summary.watcherReadyFilterCount} with target paths
              </p>
              {summary.filtersMissingTargetPath > 0 && (
                <p className="mt-2 text-xs font-medium text-yellow-600 dark:text-yellow-300">
                  {summary.filtersMissingTargetPath} active filter
                  {summary.filtersMissingTargetPath === 1 ? ' needs ' : 's need '}a target path
                </p>
              )}
            </Card>

            <Card>
              <h3 className="text-sm font-medium text-gray-500">Scheduled jobs</h3>
              <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-gray-100">{summary.enabledJobCount}</p>
              <p className="mt-1 text-sm text-gray-500">{summary.jobCount} total configured</p>
            </Card>
          </>
        )}
      </div>

      {!isAutomationSummaryLoading && !automationSummaryError ? (
        <>
          <div className="grid gap-4 xl:grid-cols-[1.15fr,0.85fr]">
            <Card>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">What to do next</h3>
                  <p className="mt-1 text-sm text-gray-500">{summary.nextStep.description}</p>
                </div>
                <Badge variant={readinessAccent}>
                  {summary.automationReady ? 'Ready' : 'Needs attention'}
                </Badge>
              </div>
              <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-gray-800/50">
                <p className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  {summary.nextStep.title}
                </p>
                <p className="mt-1 text-sm text-gray-500">{summary.nextStep.description}</p>
                <Link to={summary.nextStep.href} className={cn('mt-4 inline-flex', buttonStyles())}>
                  {summary.nextStep.cta}
                </Link>
              </div>
            </Card>

            <Card>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Automation readiness</h3>
              <div className="mt-4 space-y-3">
                {summary.readiness.map((item) => (
                  <div
                    key={item.label}
                    className={cn(
                      'rounded-2xl border p-4',
                      item.complete
                        ? 'border-green-200 bg-green-50 dark:border-green-500/30 dark:bg-green-500/10'
                        : 'border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-800/50',
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 text-sm">{item.complete ? '✓' : '•'}</span>
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.label}</p>
                        <p className="mt-1 text-xs text-gray-500">{item.hint}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {instances.length > 0 ? (
            <Card>
              <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">Instance health</h3>
              <div className="space-y-3">
                {instances.map((inst) => (
                  <div
                    key={inst.id}
                    className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-gray-800 dark:bg-gray-800/50"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${inst.enabled ? 'bg-green-500' : 'bg-gray-400 dark:bg-gray-600'}`}
                      />
                      <span className="font-medium text-gray-900 dark:text-gray-100">{inst.name}</span>
                      <Badge>{inst.type}</Badge>
                    </div>
                    <span className="text-sm text-gray-500">{inst.url}</span>
                  </div>
                ))}
              </div>
            </Card>
          ) : (
            <EmptyState
              icon={<FolderIcon className="h-7 w-7" />}
              title="No connected instances yet"
              description="Connect an Arr instance first so Filtarr can validate releases, blocklist bad items, and run scheduled automation against a real library."
              action={
                <Link to="/instances" className={buttonStyles()}>
                  <SparklesIcon className="h-4 w-4" />
                  Add first instance
                </Link>
              }
            />
          )}
        </>
      ) : null}
    </div>
  );
}
