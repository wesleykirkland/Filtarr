export interface DashboardInstanceLike {
  enabled?: boolean | number;
}

export interface DashboardFilterLike {
  enabled?: boolean | number;
  target_path?: string | null;
}

export interface DashboardJobLike {
  enabled?: boolean | number;
}

export interface DashboardSummary {
  instanceCount: number;
  activeInstanceCount: number;
  filterCount: number;
  activeFilterCount: number;
  watcherReadyFilterCount: number;
  filtersMissingTargetPath: number;
  jobCount: number;
  enabledJobCount: number;
  automationReady: boolean;
  nextStep: {
    title: string;
    description: string;
    href: string;
    cta: string;
  };
  readiness: Array<{
    label: string;
    complete: boolean;
    hint: string;
  }>;
}

function isEnabled(value?: boolean | number): boolean {
  return value === true || value === 1;
}

function hasPath(value?: string | null): boolean {
  return Boolean(value?.trim());
}

export function buildDashboardSummary({
  instances,
  filters,
  jobs,
}: {
  instances: DashboardInstanceLike[];
  filters: DashboardFilterLike[];
  jobs: DashboardJobLike[];
}): DashboardSummary {
  const activeInstanceCount = instances.filter((instance) => isEnabled(instance.enabled)).length;
  const activeFilters = filters.filter((filter) => isEnabled(filter.enabled));
  const activeFilterCount = activeFilters.length;
  const watcherReadyFilterCount = activeFilters.filter((filter) => hasPath(filter.target_path)).length;
  const filtersMissingTargetPath = activeFilters.filter((filter) => !hasPath(filter.target_path)).length;
  const enabledJobCount = jobs.filter((job) => isEnabled(job.enabled)).length;
  const automationReady =
    activeInstanceCount > 0 &&
    activeFilterCount > 0 &&
    watcherReadyFilterCount > 0 &&
    enabledJobCount > 0 &&
    filtersMissingTargetPath === 0;

  let nextStep: DashboardSummary['nextStep'];

  if (instances.length === 0) {
    nextStep = {
      title: 'Connect your first Arr instance',
      description: 'Add Sonarr, Radarr, or Lidarr so Filtarr has a system to validate and act on.',
      href: '/instances',
      cta: 'Add instance',
    };
  } else if (filters.length === 0) {
    nextStep = {
      title: 'Create your first filter',
      description: 'Define what a bad or unwanted release looks like and what Filtarr should do.',
      href: '/filters',
      cta: 'Create filter',
    };
  } else if (activeFilterCount === 0) {
    nextStep = {
      title: 'Enable at least one filter',
      description: 'You already have filters configured, but none are active right now.',
      href: '/filters',
      cta: 'Review filters',
    };
  } else if (watcherReadyFilterCount === 0 || filtersMissingTargetPath > 0) {
    nextStep = {
      title: 'Assign watched paths to active filters',
      description:
        'Active filters need target paths so watcher-driven automation knows which directories to monitor.',
      href: '/filters',
      cta: 'Fix filter paths',
    };
  } else if (jobs.length === 0) {
    nextStep = {
      title: 'Schedule your automation',
      description: 'Add a recurring job so your filters continue running even when the watcher is idle.',
      href: '/scheduler',
      cta: 'Create schedule',
    };
  } else if (enabledJobCount === 0) {
    nextStep = {
      title: 'Turn on a scheduled job',
      description: 'You have schedules configured, but they are currently disabled.',
      href: '/scheduler',
      cta: 'Enable job',
    };
  } else {
    nextStep = {
      title: 'Automation looks ready',
      description: 'Your connected instances, active filters, and enabled jobs are aligned for ongoing monitoring.',
      href: '/activity',
      cta: 'Review activity',
    };
  }

  return {
    instanceCount: instances.length,
    activeInstanceCount,
    filterCount: filters.length,
    activeFilterCount,
    watcherReadyFilterCount,
    filtersMissingTargetPath,
    jobCount: jobs.length,
    enabledJobCount,
    automationReady,
    nextStep,
    readiness: [
      {
        label: 'Connect an Arr instance',
        complete: instances.length > 0,
        hint: 'Give Filtarr a Sonarr, Radarr, or Lidarr instance to work with.',
      },
      {
        label: 'Create and enable a filter',
        complete: activeFilterCount > 0,
        hint: 'Filters determine what files to match and what action should happen on a hit.',
      },
      {
        label: 'Point active filters at target paths',
        complete: activeFilterCount > 0 && filtersMissingTargetPath === 0 && watcherReadyFilterCount > 0,
        hint: 'Target paths tell watcher mode which directories each active filter should monitor.',
      },
      {
        label: 'Enable a scheduled job',
        complete: enabledJobCount > 0,
        hint: 'Scheduling keeps your automation running on a predictable cadence.',
      },
    ],
  };
}