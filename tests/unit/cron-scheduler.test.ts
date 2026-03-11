import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const processFile = vi.fn();
  const FilterEngine = vi.fn(class MockFilterEngine {
    processFile = processFile;
  });

  return {
    cronValidate: vi.fn(), cronSchedule: vi.fn(), getAllJobs: vi.fn(), updateJob: vi.fn(), recordActivityEvent: vi.fn(),
    runSandboxedScript: vi.fn(), processFile, FilterEngine, getFilterById: vi.fn(), existsSync: vi.fn(), readdirSync: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, tasks: [] as Array<{ stop: ReturnType<typeof vi.fn>; callback: () => Promise<void> }>
  };
});

vi.mock('node-cron', () => ({ default: { validate: state.cronValidate, schedule: state.cronSchedule } }));
vi.mock('../../src/db/schemas/jobs.js', () => ({ getAllJobs: state.getAllJobs, updateJob: state.updateJob }));
vi.mock('../../src/server/lib/activity.js', () => ({ recordActivityEvent: state.recordActivityEvent }));
vi.mock('../../src/server/services/scriptRunner.js', () => ({ runSandboxedScript: state.runSandboxedScript }));
vi.mock('../../src/server/services/filterEngine.js', () => ({ FilterEngine: state.FilterEngine }));
vi.mock('../../src/db/schemas/filters.js', () => ({ getFilterById: state.getFilterById }));
vi.mock('node:fs', () => ({ default: { existsSync: state.existsSync, readdirSync: state.readdirSync } }));
vi.mock('../../src/server/lib/logger.js', () => ({ logger: state.logger }));

import { CronManager } from '../../src/server/cron/scheduler.js';

const db = {} as never;
const makeJob = (overrides: Record<string, unknown> = {}) => ({ id: 1, name: 'Job', schedule: '* * * * *', type: 'built_in', payload: undefined, enabled: 1, ...overrides });
const eventStatuses = () => state.recordActivityEvent.mock.calls.map(([, event]) => event.details?.status).filter(Boolean);

describe('CronManager', () => {
  beforeEach(() => {
    state.tasks.length = 0;
    Object.values(state.logger).forEach((mock) => mock.mockReset());
    [state.cronValidate, state.cronSchedule, state.getAllJobs, state.updateJob, state.recordActivityEvent, state.runSandboxedScript, state.processFile, state.FilterEngine, state.getFilterById, state.existsSync, state.readdirSync].forEach((mock) => mock.mockReset());
    state.cronValidate.mockReturnValue(true);
    state.cronSchedule.mockImplementation((_schedule, callback: () => Promise<void>) => {
      const stop = vi.fn();
      state.tasks.push({ stop, callback });
      return { stop };
    });
    state.processFile.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('schedules only enabled valid jobs and reloads cleanly', () => {
    state.getAllJobs.mockReturnValue([makeJob({ id: 1 }), makeJob({ id: 2, enabled: 0 }), makeJob({ id: 3, schedule: 'bad cron' })]);
    state.cronValidate.mockImplementation((schedule: string) => schedule !== 'bad cron');
    const manager = new CronManager(db);

    manager.start();
    expect(state.cronSchedule).toHaveBeenCalledTimes(1);

    manager.reload();
    expect(state.tasks[0]?.stop).toHaveBeenCalledTimes(1);
    expect(state.cronSchedule).toHaveBeenCalledTimes(2);

    manager.stop();
    expect(state.tasks[1]?.stop).toHaveBeenCalledTimes(1);
    expect(state.logger.error).toHaveBeenCalledWith({ jobId: 3, schedule: 'bad cron' }, 'Invalid cron schedule, skipping job');
  });

  it('records custom-script success and failure plus built-in skips', async () => {
    state.getAllJobs.mockReturnValue([
      makeJob({ id: 1, name: 'Pass', type: 'custom_script', payload: 'return 1;' }),
      makeJob({ id: 2, name: 'Fail', type: 'custom_script', payload: 'return 2;' }),
      makeJob({ id: 3, name: 'Builtin' }),
    ]);
    state.runSandboxedScript.mockResolvedValueOnce({ success: true, output: 1 }).mockResolvedValueOnce({ success: false, error: 'boom', logs: ['x'] });
    const manager = new CronManager(db);

    manager.start();
    for (const task of state.tasks) await task.callback();

    expect(state.runSandboxedScript).toHaveBeenNthCalledWith(1, 'return 1;', { job: { id: 1, name: 'Pass' } });
    expect(state.runSandboxedScript).toHaveBeenNthCalledWith(2, 'return 2;', { job: { id: 2, name: 'Fail' } });
    expect(state.updateJob).toHaveBeenCalledTimes(3);
    expect(eventStatuses()).toEqual(expect.arrayContaining(['started', 'success', 'failure', 'skipped']));
  });

  it('handles filter-run success, skip, and failure branches deterministically', async () => {
    state.getAllJobs.mockReturnValue([
      makeJob({ id: 1, name: 'No target', type: 'filter_run', payload: JSON.stringify({ filterId: 1 }) }),
      makeJob({ id: 2, name: 'Missing path', type: 'filter_run', payload: JSON.stringify({ filterId: 2 }) }),
      makeJob({ id: 3, name: 'Success', type: 'filter_run', payload: JSON.stringify({ filterId: 3 }) }),
      makeJob({ id: 4, name: 'Bad payload', type: 'filter_run', payload: '{' }),
    ]);
    state.getFilterById.mockImplementation((_db, id: number) => ({
      1: { id: 1, target_path: null },
      2: { id: 2, target_path: '/missing' },
      3: { id: 3, target_path: '/downloads' },
    }[id] ?? null));
    state.existsSync.mockImplementation((targetPath: string) => targetPath !== '/missing');
    state.readdirSync.mockImplementation((dir: string) => {
      if (dir === '/downloads') return [{ name: 'nested', isDirectory: () => true }, { name: 'movie.mkv', isDirectory: () => false }];
      if (dir === '/downloads/nested') return [{ name: 'sample.txt', isDirectory: () => false }];
      return [];
    });
    const manager = new CronManager(db);

    manager.start();
    for (const task of state.tasks) await task.callback();

    expect(state.processFile).toHaveBeenCalledWith('/downloads/movie.mkv', 'cron');
    expect(state.processFile).toHaveBeenCalledWith('/downloads/nested/sample.txt', 'cron');
    expect(eventStatuses()).toEqual(expect.arrayContaining(['started', 'success', 'skipped', 'failure']));
  });
});