export type SchedulerAutomationMode = 'cron' | 'watcher';

export interface SchedulerAutomationFilter {
  id: number;
  trigger_source: 'watcher' | 'cron' | 'manual';
  target_path?: string | null;
}

export function supportsWatcherAutomation(filter?: SchedulerAutomationFilter | null): boolean {
  return typeof filter?.target_path === 'string' && filter.target_path.trim().length > 0;
}

export function shouldPromptForWatcherAutomation({
  filter,
  automationMode,
  isEditing,
  hasPromptedForFilter,
}: {
  filter?: SchedulerAutomationFilter | null;
  automationMode: SchedulerAutomationMode;
  isEditing: boolean;
  hasPromptedForFilter: boolean;
}): boolean {
  if (automationMode !== 'cron' || isEditing || hasPromptedForFilter) {
    return false;
  }

  if (!filter || filter.trigger_source === 'watcher') {
    return false;
  }

  return supportsWatcherAutomation(filter);
}

export function getWatcherAutomationDeletePatch() {
  return { triggerSource: 'manual' as const };
}