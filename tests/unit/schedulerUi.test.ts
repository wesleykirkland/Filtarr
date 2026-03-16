import { describe, expect, it } from 'vitest';
import {
  getWatcherAutomationDeletePatch,
  shouldPromptForWatcherAutomation,
  supportsWatcherAutomation,
} from '../../src/client/lib/schedulerUi';

describe('schedulerUi helpers', () => {
  const watcherCapableFilter = {
    id: 7,
    trigger_source: 'cron' as const,
    target_path: ' /downloads ',
  };

  it('detects when a filter can use watcher automation', () => {
    expect(supportsWatcherAutomation(watcherCapableFilter)).toBe(true);
    expect(supportsWatcherAutomation({ ...watcherCapableFilter, target_path: '   ' })).toBe(false);
    expect(supportsWatcherAutomation()).toBe(false);
  });

  it('prompts for watcher automation only for new cron scheduling flows', () => {
    expect(
      shouldPromptForWatcherAutomation({
        filter: watcherCapableFilter,
        automationMode: 'cron',
        isEditing: false,
        hasPromptedForFilter: false,
      }),
    ).toBe(true);

    expect(
      shouldPromptForWatcherAutomation({
        filter: { ...watcherCapableFilter, trigger_source: 'watcher' },
        automationMode: 'cron',
        isEditing: false,
        hasPromptedForFilter: false,
      }),
    ).toBe(false);

    expect(
      shouldPromptForWatcherAutomation({
        filter: watcherCapableFilter,
        automationMode: 'watcher',
        isEditing: false,
        hasPromptedForFilter: false,
      }),
    ).toBe(false);

    expect(
      shouldPromptForWatcherAutomation({
        filter: watcherCapableFilter,
        automationMode: 'cron',
        isEditing: true,
        hasPromptedForFilter: false,
      }),
    ).toBe(false);

    expect(
      shouldPromptForWatcherAutomation({
        filter: watcherCapableFilter,
        automationMode: 'cron',
        isEditing: false,
        hasPromptedForFilter: true,
      }),
    ).toBe(false);
  });

  it('converts watcher deletion into a manual trigger state', () => {
    expect(getWatcherAutomationDeletePatch()).toEqual({ triggerSource: 'manual' });
  });
});
