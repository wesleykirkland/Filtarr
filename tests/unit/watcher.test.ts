import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockWatcher = {
  id: number;
  closed: boolean;
  on: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

const state = vi.hoisted(() => {
  const processFile = vi.fn();
  return {
    watch: vi.fn(),
    watchers: [] as MockWatcher[],
    events: [] as string[],
    closeDelayMs: 0,
    getAllFilters: vi.fn(),
    getWatcherPaths: vi.fn(),
    getConfig: vi.fn(),
    processFile,
    FilterEngine: vi.fn(class MockFilterEngine {
      processFile = processFile;
    }),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
});

vi.mock('chokidar', () => ({ default: { watch: state.watch } }));
vi.mock('../../src/server/lib/logger.js', () => ({ logger: state.logger }));
vi.mock('../../src/config/index.js', () => ({ getConfig: state.getConfig }));
vi.mock('../../src/db/schemas/filters.js', () => ({ getAllFilters: state.getAllFilters }));
vi.mock('../../src/server/services/filterPaths.js', () => ({ getWatcherPaths: state.getWatcherPaths }));
vi.mock('../../src/server/services/filterEngine.js', () => ({ FilterEngine: state.FilterEngine }));

import { ChokidarManager, isIgnoredWatcherPath } from '../../src/server/services/watcher.js';

const db = {} as never;
const liveWatchers = () => state.watchers.filter((w) => !w.closed);

describe('ChokidarManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.watchers.length = 0;
    state.events.length = 0;
    state.closeDelayMs = 0;
    state.getAllFilters.mockReturnValue([]);
    state.getWatcherPaths.mockReturnValue(['/downloads']);
    state.getConfig.mockReturnValue({ watcherPolling: false });
    state.processFile.mockResolvedValue(undefined);
    state.watch.mockImplementation(() => {
      const watcher: MockWatcher = {
        id: state.watchers.length + 1,
        closed: false,
        on: vi.fn(),
        close: vi.fn(async () => {
          state.events.push(`close:start:${watcher.id}`);
          await new Promise((resolve) => setTimeout(resolve, state.closeDelayMs));
          watcher.closed = true;
          state.events.push(`close:end:${watcher.id}`);
        }),
      };
      watcher.on.mockReturnValue(watcher);
      state.watchers.push(watcher);
      state.events.push(`watch:${watcher.id}`);
      return watcher;
    });
  });

  it('coalesces two concurrent reloads into exactly one live watcher', async () => {
    const manager = new ChokidarManager(db);
    await manager.start();
    expect(state.watch).toHaveBeenCalledTimes(1);

    state.closeDelayMs = 20;
    await Promise.all([manager.reload(), manager.reload()]);

    expect(state.watch).toHaveBeenCalledTimes(2);
    expect(liveWatchers()).toHaveLength(1);
    // close() of the old watcher fully resolves before the new watch() is created.
    expect(state.events).toEqual(['watch:1', 'close:start:1', 'close:end:1', 'watch:2']);
  });

  it('awaits close() before creating a new watcher even when start() is not awaited', async () => {
    const manager = new ChokidarManager(db);
    state.closeDelayMs = 20;

    // Fire-and-forget, like initWatcher()/reloadWatcher() callers.
    void manager.start();
    void manager.reload();
    await manager.reload();

    expect(liveWatchers()).toHaveLength(1);
    expect(state.events).toEqual(['watch:1', 'close:start:1', 'close:end:1', 'watch:2']);
  });

  it('queues a fresh reload when one is requested while a reload is running', async () => {
    const manager = new ChokidarManager(db);
    await manager.start();
    state.closeDelayMs = 20;

    const first = manager.reload();
    // Let the first reload begin running (it is now closing watcher 1).
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = manager.reload();
    expect(second).not.toBe(first);
    await Promise.all([first, second]);

    expect(state.watch).toHaveBeenCalledTimes(3);
    expect(liveWatchers()).toHaveLength(1);
  });

  it('keeps the lifecycle chain usable after a failed operation', async () => {
    const manager = new ChokidarManager(db);
    state.getAllFilters.mockImplementationOnce(() => {
      throw new Error('db down');
    });

    await expect(manager.start()).rejects.toThrow('db down');
    await manager.reload();

    expect(liveWatchers()).toHaveLength(1);
  });

  it('passes ignore and polling options to chokidar', async () => {
    state.getConfig.mockReturnValue({ watcherPolling: true });
    const manager = new ChokidarManager(db);
    await manager.start();

    const options = state.watch.mock.calls[0]?.[1];
    expect(options).toMatchObject({ usePolling: true, ignoreInitial: true });
    expect(options.ignored('/downloads/movie.mkv.part')).toBe(true);
    expect(options.ignored('/downloads/movie.mkv')).toBe(false);

    await manager.stop();
    expect(liveWatchers()).toHaveLength(0);
  });

  it('does not enable polling by default', async () => {
    const manager = new ChokidarManager(db);
    await manager.start();
    expect(state.watch.mock.calls[0]?.[1]).not.toHaveProperty('usePolling');
  });

  it('routes add/change events to the filter engine and ignores unlink', async () => {
    const manager = new ChokidarManager(db);
    await manager.start();

    const handlers = Object.fromEntries(
      (state.watchers[0]?.on.mock.calls ?? []).map(([event, handler]) => [event, handler]),
    );
    handlers.add('/downloads/a.mkv');
    handlers.change('/downloads/b.mkv');
    handlers.unlink('/downloads/c.mkv');

    expect(state.processFile).toHaveBeenCalledTimes(2);
    expect(state.processFile).toHaveBeenCalledWith('/downloads/a.mkv');
    expect(state.processFile).toHaveBeenCalledWith('/downloads/b.mkv');
  });
});

describe('isIgnoredWatcherPath', () => {
  it.each([
    ['/downloads/movie.mkv.part', true],
    ['/downloads/movie.mkv.!qB', true],
    ['/downloads/movie.mkv.!qb', true],
    ['/downloads/movie.mkv.crdownload', true],
    ['/downloads/.DS_Store', true],
    ['/downloads/show/.hidden-dir', true],
    ['/downloads/movie.mkv', false],
    ['/downloads/partial.mkv', false],
  ])('%s -> %s', (filePath, expected) => {
    expect(isIgnoredWatcherPath(filePath)).toBe(expected);
  });
});
