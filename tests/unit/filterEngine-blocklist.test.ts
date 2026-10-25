import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { FilterRow } from '../../src/db/schemas/filters.js';
import type { ArrInstanceConfig } from '../../src/services/arr/types.js';

// Mock dependencies before importing FilterEngine
vi.mock('../../src/db/schemas/filters.js', () => ({
  getAllFilters: vi.fn(() => []),
}));

vi.mock('../../src/db/schemas/instances.js', () => ({
  getInstanceConfigById: vi.fn(),
}));

vi.mock('../../src/server/routes/instances.js', () => ({
  createArrClient: vi.fn(),
}));

vi.mock('../../src/server/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/server/services/NotificationService.js', () => ({
  NotificationService: class {
    notifyFilterMatch = vi.fn();
  },
}));

vi.mock('../../src/server/services/scriptRunner.js', () => ({
  normalizeScriptRuntime: vi.fn((r: string) => r),
  runConfiguredScript: vi.fn(),
}));

import { FilterEngine } from '../../src/server/services/filterEngine.js';
import { getInstanceConfigById } from '../../src/db/schemas/instances.js';
import { createArrClient } from '../../src/server/routes/instances.js';
import { logger } from '../../src/server/lib/logger.js';

const mockGetInstanceConfigById = vi.mocked(getInstanceConfigById);
const mockCreateArrClient = vi.mocked(createArrClient);

function makeFilter(overrides: Partial<FilterRow> = {}): FilterRow {
  return {
    id: 1,
    name: 'Test Filter',
    description: null,
    trigger_source: 'watcher',
    rule_type: 'extension',
    rule_payload: 'exe',
    action_type: 'blocklist',
    action_payload: null,
    script_runtime: 'shell',
    target_path: '/downloads',
    is_built_in: 0,
    notify_on_match: 0,
    notify_webhook_url: null,
    notify_slack: 0,
    notify_slack_token: null,
    notify_slack_channel: null,
    override_notifications: 0,
    instance_id: 1,
    enabled: 1,
    sort_order: 0,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    ...overrides,
  };
}

function makeInstanceConfig(overrides: Partial<ArrInstanceConfig> = {}): ArrInstanceConfig {
  return {
    id: 1,
    name: 'Sonarr',
    type: 'sonarr',
    url: 'http://localhost:8989',
    apiKey: 'test-key',
    timeout: 30000,
    enabled: true,
    skipSslVerify: false,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
    ...overrides,
  };
}

function makeQueueRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    downloadId: 'dl-1',
    title: 'Test Release',
    size: 1000,
    sizeleft: 0,
    status: 'completed' as const,
    trackedDownloadState: 'imported' as const,
    trackedDownloadStatus: 'ok',
    statusMessages: [],
    errorMessage: '',
    downloadClient: 'qbit',
    outputPath: '/downloads/Release',
    indexer: 'test',
    protocol: 'usenet',
    timeleft: '00:00:00',
    estimatedCompletionTime: '',
    added: '2024-01-01',
    ...overrides,
  };
}

const fakeDb = {} as any;

function makeMockClient(queue: ReturnType<typeof makeQueueRecord>[]) {
  return {
    getAllQueueItems: vi.fn().mockResolvedValue(queue),
    deleteQueueItem: vi.fn().mockResolvedValue(undefined),
    blocklistAndRemove: vi.fn().mockResolvedValue(undefined),
    searchEpisodes: vi.fn(),
    searchMovies: vi.fn(),
    searchAlbum: vi.fn(),
  };
}

type MockClient = ReturnType<typeof makeMockClient>;

function expectNoSearch(client: MockClient) {
  expect(client.searchEpisodes).not.toHaveBeenCalled();
  expect(client.searchMovies).not.toHaveBeenCalled();
  expect(client.searchAlbum).not.toHaveBeenCalled();
  expect(client.blocklistAndRemove).not.toHaveBeenCalled();
}

const fileEvent = (filePath: string) => ({
  path: filePath,
  name: filePath.split('/').pop() ?? '',
  size: 100,
  extension: filePath.split('.').pop() ?? '',
});

describe('handleBlocklist behaviors', () => {
  let engine: FilterEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new FilterEngine(fakeDb);
  });

  function setup(type: ArrInstanceConfig['type'], queue = [makeQueueRecord()]) {
    mockGetInstanceConfigById.mockReturnValue(makeInstanceConfig({ type }));
    const client = makeMockClient(queue);
    mockCreateArrClient.mockReturnValue(client as any);
    return client;
  }

  it.each(['sonarr', 'radarr', 'lidarr'] as const)(
    'blocklist_and_search uses Arr-native redownload without an explicit search (%s)',
    async (type) => {
      const client = setup(type);
      const filter = makeFilter({ action_payload: 'blocklist_and_search' });

      await (engine as any).handleBlocklist(filter, fileEvent('/downloads/Release/test.exe'));

      expect(client.deleteQueueItem).toHaveBeenCalledWith(42, {
        blocklist: true,
        removeFromClient: true,
        skipRedownload: false,
      });
      expectNoSearch(client);
    },
  );

  it.each([null, ''])('defaults to blocklist_and_search when action_payload is %j', async (payload) => {
    const client = setup('sonarr');
    const filter = makeFilter({ action_payload: payload as string | null });

    await (engine as any).handleBlocklist(filter, fileEvent('/downloads/Release/test.exe'));

    expect(client.deleteQueueItem).toHaveBeenCalledWith(42, {
      blocklist: true,
      removeFromClient: true,
      skipRedownload: false,
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('blocklist_only calls deleteQueueItem with blocklist=true and skipRedownload=true', async () => {
    const client = setup('sonarr');
    const filter = makeFilter({ action_payload: 'blocklist_only' });

    await (engine as any).handleBlocklist(filter, fileEvent('/downloads/Release/test.exe'));

    expect(client.deleteQueueItem).toHaveBeenCalledWith(42, {
      blocklist: true,
      removeFromClient: true,
      skipRedownload: true,
    });
    expectNoSearch(client);
  });

  it('remove_only calls deleteQueueItem with blocklist=false', async () => {
    const client = setup('radarr');
    const filter = makeFilter({ action_payload: 'remove_only' });

    await (engine as any).handleBlocklist(filter, fileEvent('/downloads/Release/movie.mkv'));

    expect(client.deleteQueueItem).toHaveBeenCalledWith(42, {
      blocklist: false,
      removeFromClient: true,
      skipRedownload: false,
    });
    expectNoSearch(client);
  });

  it('falls back to the default behavior and logs an error for an invalid stored payload', async () => {
    const client = setup('sonarr');
    const filter = makeFilter({ action_payload: 'do_not_blocklist' });

    await (engine as any).handleBlocklist(filter, fileEvent('/downloads/Release/test.exe'));

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ filterId: 1, actionPayload: 'do_not_blocklist' }),
      expect.stringContaining('Invalid blocklist behavior'),
    );
    expect(client.deleteQueueItem).toHaveBeenCalledWith(42, {
      blocklist: true,
      removeFromClient: true,
      skipRedownload: false,
    });
  });

  it('does not match a queue item whose outputPath is only a string prefix of the file path', async () => {
    const client = setup('sonarr', [makeQueueRecord({ outputPath: '/downloads/Show.S02' })]);
    const filter = makeFilter({ action_payload: 'blocklist_and_search' });

    await (engine as any).handleBlocklist(filter, fileEvent('/downloads/Show/episode.exe'));

    expect(client.deleteQueueItem).not.toHaveBeenCalled();
  });

  it('does not match a sibling directory that shares the outputPath as a string prefix', async () => {
    // Regression: a bare startsWith('/downloads/Show') would match '/downloads/Show.S02/...'
    const client = setup('sonarr', [makeQueueRecord({ outputPath: '/downloads/Show' })]);
    const filter = makeFilter({ action_payload: 'blocklist_and_search' });

    await (engine as any).handleBlocklist(filter, fileEvent('/downloads/Show.S02/episode.exe'));

    expect(client.deleteQueueItem).not.toHaveBeenCalled();
  });

  it('matches a file nested under the queue item outputPath', async () => {
    const client = setup('sonarr', [
      makeQueueRecord({ id: 1, outputPath: '/downloads/Show.S02' }),
      makeQueueRecord({ id: 2, outputPath: '/downloads/Show' }),
    ]);
    const filter = makeFilter({ action_payload: 'blocklist_only' });

    await (engine as any).handleBlocklist(filter, fileEvent('/downloads/Show/Season 1/episode.exe'));

    expect(client.deleteQueueItem).toHaveBeenCalledTimes(1);
    expect(client.deleteQueueItem).toHaveBeenCalledWith(2, expect.any(Object));
  });

  it('does nothing when no matching queue item is found', async () => {
    const client = setup('sonarr', []);
    const filter = makeFilter({ action_payload: 'blocklist_and_search' });

    await (engine as any).handleBlocklist(filter, fileEvent('/other/test.exe'));

    expect(client.deleteQueueItem).not.toHaveBeenCalled();
    expect(client.blocklistAndRemove).not.toHaveBeenCalled();
  });

  it('returns early when no instance_id is set', async () => {
    const filter = makeFilter({ instance_id: null });

    await (engine as any).handleBlocklist(filter, fileEvent('/downloads/Release/test.exe'));

    expect(mockCreateArrClient).not.toHaveBeenCalled();
  });

  it.each(['/', '/downloads', ''])('ignores queue items with an overly broad outputPath %j', async (outputPath) => {
    const client = setup('sonarr', [makeQueueRecord({ outputPath })]);
    const filter = makeFilter({ action_payload: 'blocklist_only' });

    await (engine as any).handleBlocklist(filter, fileEvent('/downloads/Release/test.exe'));

    expect(client.deleteQueueItem).not.toHaveBeenCalled();
  });

  it('logs at debug when ignoring a root outputPath', async () => {
    setup('sonarr', [makeQueueRecord({ outputPath: '/' })]);
    const filter = makeFilter({ action_payload: 'blocklist_only' });

    await (engine as any).handleBlocklist(filter, fileEvent('/downloads/Release/test.exe'));

    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ outputPath: '/' }),
      expect.stringContaining('overly broad outputPath'),
    );
  });

  describe('local-to-remote path translation', () => {
    function setupMapped(queue: ReturnType<typeof makeQueueRecord>[]) {
      mockGetInstanceConfigById.mockReturnValue(
        makeInstanceConfig({ localPath: '/dl', remotePath: '/remote/downloads' }),
      );
      const client = makeMockClient(queue);
      mockCreateArrClient.mockReturnValue(client as any);
      return client;
    }

    it('translates files under the local mapping to the remote path', async () => {
      const client = setupMapped([makeQueueRecord({ outputPath: '/remote/downloads/Release' })]);

      await (engine as any).handleBlocklist(
        makeFilter({ action_payload: 'blocklist_only' }),
        fileEvent('/dl/Release/test.exe'),
      );

      expect(client.deleteQueueItem).toHaveBeenCalledWith(42, expect.any(Object));
    });

    it('does not translate a sibling directory sharing the local mapping as a string prefix', async () => {
      // /dl must not match /dl2/...; a bare startsWith would have produced
      // /remote/downloads/2/Release/test.exe. The path must stay untranslated.
      const client = setupMapped([
        makeQueueRecord({ id: 7, outputPath: '/remote/downloads/2' }),
        makeQueueRecord({ id: 8, outputPath: '/dl2/Release' }),
      ]);

      await (engine as any).handleBlocklist(
        makeFilter({ action_payload: 'blocklist_only' }),
        fileEvent('/dl2/Release/test.exe'),
      );

      expect(client.deleteQueueItem).toHaveBeenCalledTimes(1);
      expect(client.deleteQueueItem).toHaveBeenCalledWith(8, expect.any(Object));
    });
  });
});
