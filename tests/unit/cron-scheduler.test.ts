import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const processFile = vi.fn();
  const FilterEngine = vi.fn(class MockFilterEngine {
    processFile = processFile;
  });

  return {
    cronValidate: vi.fn(), cronSchedule: vi.fn(), getAllJobs: vi.fn(), updateJob: vi.fn(), recordActivityEvent: vi.fn(),
    runSandboxedScript: vi.fn(), processFile, FilterEngine, getFilterById: vi.fn(), existsSync: vi.fn(), readdir: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, tasks: [] as Array<{ stop: ReturnType<typeof vi.fn>; callback: () => Promise<void> }>
  };
});

vi.mock('node-cron', () => ({ default: { validate: state.cronValidate, schedule: state.cronSchedule } }));
vi.mock('../../src/db/schemas/jobs.js', () => ({ getAllJobs: state.getAllJobs, updateJob: state.updateJob }));
vi.mock('../../src/server/lib/activity.js', () => ({ recordActivityEvent: state.recordActivityEvent }));
vi.mock('../../src/server/services/scriptRunner.js', () => ({ runSandboxedScript: state.runSandboxedScript }));
vi.mock('../../src/server/services/filterEngine.js', () => ({ FilterEngine: state.FilterEngine }));
vi.mock('../../src/db/schemas/filters.js', () => ({ getFilterById: state.getFilterById }));
vi.mock('node:fs', () => ({ default: { existsSync: state.existsSync, promises: { readdir: state.readdir } } }));
vi.mock('../../src/server/lib/logger.js', () => ({ logger: state.logger }));

import { CronManager, FILTER_JOB_CONCURRENCY, forEachWithConcurrency } from '../../src/server/cron/scheduler.js';

const db = {} as never;
const makeJob = (overrides: Record<string, unknown> = {}) => ({ id: 1, name: 'Job', schedule: '* * * * *', type: 'built_in', payload: undefined, enabled: 1, ...overrides });
const eventStatuses = () => state.recordActivityEvent.mock.calls.map(([, event]) => event.details?.status).filter(Boolean);

describe('CronManager', () => {
  beforeEach(() => {
    state.tasks.length = 0;
    Object.values(state.logger).forEach((mock) => mock.mockReset());
    [state.cronValidate, state.cronSchedule, state.getAllJobs, state.updateJob, state.recordActivityEvent, state.runSandboxedScript, state.processFile, state.FilterEngine, state.getFilterById, state.existsSync, state.readdir].forEach((mock) => mock.mockReset());
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
    state.readdir.mockImplementation(async (dir: string) => {
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

  const setupFilterJob = (files: string[]) => {
    state.getAllJobs.mockReturnValue([makeJob({ id: 9, name: 'Crawl', type: 'filter_run', payload: JSON.stringify({ filterId: 3 }) })]);
    state.getFilterById.mockReturnValue({ id: 3, target_path: '/downloads' });
    state.existsSync.mockReturnValue(true);
    state.readdir.mockImplementation(async (dir: string) =>
      dir === '/downloads' ? files.map((name) => ({ name, isDirectory: () => false })) : [],
    );
  };

  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    return { promise, resolve };
  };

  it('awaits file processing before recording completion', async () => {
    setupFilterJob(['a.mkv', 'b.mkv']);
    const gates = [deferred(), deferred()];
    state.processFile.mockImplementationOnce(() => gates[0]?.promise).mockImplementationOnce(() => gates[1]?.promise);
    const manager = new CronManager(db);
    manager.start();

    const run = state.tasks[0]?.callback();
    await vi.waitFor(() => expect(state.processFile).toHaveBeenCalledTimes(2));
    expect(eventStatuses()).toEqual(['started']);
    expect(state.updateJob).not.toHaveBeenCalled();

    gates.forEach((gate) => gate.resolve());
    await run;
    expect(eventStatuses()).toEqual(['started', 'success']);
    expect(state.updateJob).toHaveBeenCalledTimes(1);
  });

  it('records a failure when any file fails to process', async () => {
    setupFilterJob(['a.mkv', 'b.mkv', 'c.mkv']);
    state.processFile.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);
    const manager = new CronManager(db);
    manager.start();

    await state.tasks[0]?.callback();

    expect(state.processFile).toHaveBeenCalledTimes(3);
    expect(eventStatuses()).toEqual(['started', 'failure']);
    const failure = state.recordActivityEvent.mock.calls.at(-1)?.[1];
    expect(failure.details).toMatchObject({ queuedFiles: 3, failedFiles: 1 });
  });

  it('processes files with bounded concurrency', async () => {
    setupFilterJob(Array.from({ length: 10 }, (_, i) => `${i}.mkv`));
    let inFlight = 0;
    let maxInFlight = 0;
    state.processFile.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
    });
    const manager = new CronManager(db);
    manager.start();

    await state.tasks[0]?.callback();

    expect(state.processFile).toHaveBeenCalledTimes(10);
    expect(maxInFlight).toBe(FILTER_JOB_CONCURRENCY);
  });

  it('does not let a slow job overlap itself', async () => {
    setupFilterJob(['slow.mkv']);
    const gate = deferred();
    state.processFile.mockImplementation(() => gate.promise);
    const manager = new CronManager(db);
    manager.start();
    const tick = state.tasks[0]?.callback;

    const first = tick?.();
    await vi.waitFor(() => expect(state.processFile).toHaveBeenCalledTimes(1));
    await tick?.();

    expect(state.processFile).toHaveBeenCalledTimes(1);
    expect(state.logger.warn).toHaveBeenCalledWith(
      { jobId: 9, name: 'Crawl' },
      'Skipping scheduled job tick because the previous run is still in progress',
    );
    expect(eventStatuses()).toEqual(['started']);

    gate.resolve();
    await first;

    // Once the slow run finishes, the next tick runs normally.
    await tick?.();
    expect(state.processFile).toHaveBeenCalledTimes(2);
    expect(eventStatuses()).toEqual(['started', 'success', 'started', 'success']);
  });
});

describe('forEachWithConcurrency', () => {
  it('handles sync iterables and propagates source errors after in-flight work settles', async () => {
    const seen: number[] = [];
    await forEachWithConcurrency([1, 2, 3], 2, async (n) => { seen.push(n); });
    expect(seen).toEqual([1, 2, 3]);

    async function* failing() {
      yield 1;
      throw new Error('readdir failed');
    }
    await expect(forEachWithConcurrency(failing(), 2, async () => {})).rejects.toThrow('readdir failed');
  });
});