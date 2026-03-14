import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const processFile = vi.fn();
  const FilterEngine = vi.fn(class MockFilterEngine {
    processFile = processFile;
  });

  return {
    watch: vi.fn(),
    getAllFilters: vi.fn(),
    getWatcherPaths: vi.fn(),
    processFile,
    FilterEngine,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
});

vi.mock('chokidar', () => ({ default: { watch: state.watch } }));
vi.mock('../../src/db/schemas/filters.js', () => ({ getAllFilters: state.getAllFilters }));
vi.mock('../../src/server/services/filterPaths.js', () => ({ getWatcherPaths: state.getWatcherPaths }));
vi.mock('../../src/server/services/filterEngine.js', () => ({ FilterEngine: state.FilterEngine }));
vi.mock('../../src/server/lib/logger.js', () => ({ logger: state.logger }));

import { ChokidarManager, initWatcher, reloadWatcher, stopWatcher } from '../../src/server/services/watcher.js';

const db = {} as never;
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const createWatcher = () => {
  const handlers: Record<string, (value: any) => void> = {};
  const watcher = {
    on: vi.fn((event: string, callback: (value: any) => void) => {
      handlers[event] = callback;
      return watcher;
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };

  return { watcher, handlers };
};

describe('watcher service', () => {
  beforeEach(() => {
    [state.watch, state.getAllFilters, state.getWatcherPaths, state.processFile, state.FilterEngine].forEach((mock) => mock.mockReset());
    Object.values(state.logger).forEach((mock) => mock.mockReset());
    stopWatcher();
  });

  afterEach(() => {
    stopWatcher();
    vi.restoreAllMocks();
  });

  it('starts an empty watcher when there are no enabled filter paths', async () => {
    const { watcher } = createWatcher();
    state.getAllFilters.mockReturnValue([]);
    state.getWatcherPaths.mockReturnValue([]);
    state.watch.mockReturnValue(watcher);

    const manager = new ChokidarManager(db);
    await manager.start();

    expect(state.FilterEngine).toHaveBeenCalledWith(db);
    expect(state.watch).toHaveBeenCalledWith([], { persistent: true });
    expect(state.logger.info).toHaveBeenCalledWith('No valid enabled filter paths configured for watching.');
  });

  it('watches enabled filter paths, handles file events, and logs watcher errors', async () => {
    const { watcher, handlers } = createWatcher();
    const processError = new Error('process failed');
    state.getAllFilters.mockReturnValue([
      { id: 1, target_path: '/downloads', enabled: 1, trigger_source: 'watcher' },
      { id: 2, target_path: '/imports', enabled: 1, trigger_source: 'watcher' },
      { id: 3, target_path: null, enabled: 1, trigger_source: 'watcher' },
    ]);
    state.getWatcherPaths.mockReturnValue(['/downloads', '/imports']);
    state.watch.mockReturnValue(watcher);
    state.processFile.mockResolvedValueOnce(undefined).mockRejectedValueOnce(processError);

    const manager = new ChokidarManager(db);
    await manager.start();

    expect(state.watch).toHaveBeenCalledWith(
      ['/downloads', '/imports'],
      expect.objectContaining({ ignoreInitial: true }),
    );

    handlers['add']?.('/downloads/new.mkv');
    handlers['change']?.('/downloads/changed.mkv');
    handlers['unlink']?.('/downloads/deleted.mkv');
    handlers['error']?.(new Error('watcher boom'));
    await flush();

    expect(state.processFile).toHaveBeenNthCalledWith(1, '/downloads/new.mkv');
    expect(state.processFile).toHaveBeenNthCalledWith(2, '/downloads/changed.mkv');
    expect(state.logger.debug).toHaveBeenCalledWith({ event: 'delete', file: 'deleted.mkv' }, 'File event detected');
    expect(state.logger.error).toHaveBeenCalledWith(
      { err: processError, filePath: '/downloads/changed.mkv' },
      'Filter engine failed to process file',
    );
    expect(state.logger.error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'Watcher error',
    );
  });

  it('reloads and stops the active watcher cleanly', async () => {
    const first = createWatcher();
    const second = createWatcher();
    state.getAllFilters.mockReturnValue([{ id: 1, target_path: '/downloads', enabled: 1, trigger_source: 'watcher' }]);
    state.getWatcherPaths.mockReturnValue(['/downloads']);
    state.watch.mockReturnValueOnce(first.watcher).mockReturnValueOnce(second.watcher);

    const manager = new ChokidarManager(db);
    await manager.start();
    await manager.reload();
    await manager.stop();

    expect(first.watcher.close).toHaveBeenCalledTimes(1);
    expect(second.watcher.close).toHaveBeenCalledTimes(1);
    expect(state.watch).toHaveBeenCalledTimes(2);
  });

  it('no-ops when wrapper helpers are called without an active singleton manager', async () => {
    reloadWatcher();
    stopWatcher();
    await flush();

    expect(state.watch).not.toHaveBeenCalled();
    expect(state.logger.error).not.toHaveBeenCalled();
  });

  it('swallows wrapper-level reload and stop rejections from the active singleton manager', async () => {
    const { watcher } = createWatcher();
    watcher.close.mockRejectedValue(new Error('close failed'));
    state.getAllFilters.mockReturnValue([{ id: 1, target_path: '/downloads', enabled: 1, trigger_source: 'watcher' }]);
    state.getWatcherPaths.mockReturnValue(['/downloads']);
    state.watch.mockReturnValue(watcher);

    initWatcher(db);
    await flush();

    reloadWatcher();
    stopWatcher();
    await flush();

    expect(state.watch).toHaveBeenCalledTimes(1);
    expect(watcher.close).toHaveBeenCalledTimes(2);
    expect(state.logger.error).not.toHaveBeenCalled();
  });

  it('manages the singleton wrapper lifecycle and startup failures', async () => {
    state.getAllFilters.mockImplementation(() => {
      throw new Error('db unavailable');
    });

    initWatcher(db);
    await flush();
    expect(state.logger.error).toHaveBeenCalledWith({ err: expect.any(Error) }, 'Failed to start Chokidar watcher');
    stopWatcher();

    const { watcher } = createWatcher();
    state.getAllFilters.mockReset();
    state.getAllFilters.mockReturnValue([{ id: 1, target_path: '/downloads', enabled: 1, trigger_source: 'watcher' }]);
    state.getWatcherPaths.mockReturnValue(['/downloads']);
    state.watch.mockReturnValue(watcher);

    initWatcher(db);
    initWatcher(db);
    reloadWatcher();
    stopWatcher();
    await flush();

    expect(state.watch).toHaveBeenCalledTimes(2);
    expect(watcher.close).toHaveBeenCalled();
  });
});
