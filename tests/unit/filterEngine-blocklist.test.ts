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

vi.mock('../../src/server/services/filterPaths.js', () => ({
  isPathWithinTarget: vi.fn(() => true),
  normalizeFilterTargetPath: vi.fn((p: string) => p),
}));

vi.mock('../../src/server/services/scriptRunner.js', () => ({
  normalizeScriptRuntime: vi.fn((r: string) => r),
  runConfiguredScript: vi.fn(),
}));

import { FilterEngine } from '../../src/server/services/filterEngine.js';
import { getInstanceConfigById } from '../../src/db/schemas/instances.js';
import { createArrClient } from '../../src/server/routes/instances.js';
import { SonarrClient } from '../../src/services/arr/sonarr.js';
import { RadarrClient } from '../../src/services/arr/radarr.js';
import { LidarrClient } from '../../src/services/arr/lidarr.js';

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
    outputPath: '/downloads',
    indexer: 'test',
    protocol: 'usenet',
    timeleft: '00:00:00',
    estimatedCompletionTime: '',
    added: '2024-01-01',
    ...overrides,
  };
}

const fakeDb = {} as any;

describe('handleBlocklist behaviors', () => {
  let engine: FilterEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new FilterEngine(fakeDb);
  });

  it('defaults to blocklist_and_search when action_payload is null (sonarr)', async () => {
    const filter = makeFilter({ action_payload: null, instance_id: 1 });
    const config = makeInstanceConfig({ type: 'sonarr' });
    mockGetInstanceConfigById.mockReturnValue(config);

    const mockClient = Object.create(SonarrClient.prototype);
    mockClient.getQueue = vi.fn().mockResolvedValue({
      records: [makeQueueRecord({ seriesId: 5, episodeId: 10 })],
    });
    mockClient.blocklistAndRemove = vi.fn().mockResolvedValue(undefined);
    mockClient.searchEpisodes = vi.fn().mockResolvedValue({});
    mockCreateArrClient.mockReturnValue(mockClient);

    // Access private method via any
    await (engine as any).handleBlocklist(filter, { path: '/downloads/test.exe', name: 'test.exe', size: 100, extension: 'exe' });

    expect(mockClient.blocklistAndRemove).toHaveBeenCalledWith(42);
    expect(mockClient.searchEpisodes).toHaveBeenCalledWith([10]);
  });

  it('blocklist_and_search triggers searchMovies for radarr', async () => {
    const filter = makeFilter({ action_payload: 'blocklist_and_search', instance_id: 1 });
    const config = makeInstanceConfig({ type: 'radarr', name: 'Radarr' });
    mockGetInstanceConfigById.mockReturnValue(config);

    const mockClient = Object.create(RadarrClient.prototype);
    mockClient.getQueue = vi.fn().mockResolvedValue({
      records: [makeQueueRecord({ movieId: 7 })],
    });
    mockClient.blocklistAndRemove = vi.fn().mockResolvedValue(undefined);
    mockClient.searchMovies = vi.fn().mockResolvedValue({});
    mockCreateArrClient.mockReturnValue(mockClient);

    await (engine as any).handleBlocklist(filter, { path: '/downloads/movie.mkv', name: 'movie.mkv', size: 100, extension: 'mkv' });

    expect(mockClient.blocklistAndRemove).toHaveBeenCalledWith(42);
    expect(mockClient.searchMovies).toHaveBeenCalledWith([7]);
  });

  it('blocklist_and_search triggers searchAlbum for lidarr', async () => {
    const filter = makeFilter({ action_payload: 'blocklist_and_search', instance_id: 1 });
    const config = makeInstanceConfig({ type: 'lidarr', name: 'Lidarr' });
    mockGetInstanceConfigById.mockReturnValue(config);

    const mockClient = Object.create(LidarrClient.prototype);
    mockClient.getQueue = vi.fn().mockResolvedValue({
      records: [makeQueueRecord({ artistId: 3, albumId: 15 })],
    });
    mockClient.blocklistAndRemove = vi.fn().mockResolvedValue(undefined);
    mockClient.searchAlbum = vi.fn().mockResolvedValue({});
    mockCreateArrClient.mockReturnValue(mockClient);

    await (engine as any).handleBlocklist(filter, { path: '/downloads/album.flac', name: 'album.flac', size: 100, extension: 'flac' });

    expect(mockClient.blocklistAndRemove).toHaveBeenCalledWith(42);
    expect(mockClient.searchAlbum).toHaveBeenCalledWith(15);
  });

  it('blocklist_only calls deleteQueueItem with blocklist=true and skipRedownload=true', async () => {
    const filter = makeFilter({ action_payload: 'blocklist_only', instance_id: 1 });
    const config = makeInstanceConfig({ type: 'sonarr' });
    mockGetInstanceConfigById.mockReturnValue(config);

    const mockClient = Object.create(SonarrClient.prototype);
    mockClient.getQueue = vi.fn().mockResolvedValue({
      records: [makeQueueRecord({ seriesId: 5, episodeId: 10 })],
    });
    mockClient.deleteQueueItem = vi.fn().mockResolvedValue(undefined);
    mockCreateArrClient.mockReturnValue(mockClient);

    await (engine as any).handleBlocklist(filter, { path: '/downloads/test.exe', name: 'test.exe', size: 100, extension: 'exe' });

    expect(mockClient.deleteQueueItem).toHaveBeenCalledWith(42, {
      blocklist: true,
      removeFromClient: true,
      skipRedownload: true,
    });
  });

  it('do_not_blocklist calls deleteQueueItem with blocklist=false', async () => {
    const filter = makeFilter({ action_payload: 'do_not_blocklist', instance_id: 1 });
    const config = makeInstanceConfig({ type: 'radarr', name: 'Radarr' });
    mockGetInstanceConfigById.mockReturnValue(config);

    const mockClient = Object.create(RadarrClient.prototype);
    mockClient.getQueue = vi.fn().mockResolvedValue({
      records: [makeQueueRecord({ movieId: 7 })],
    });
    mockClient.deleteQueueItem = vi.fn().mockResolvedValue(undefined);
    mockCreateArrClient.mockReturnValue(mockClient);

    await (engine as any).handleBlocklist(filter, { path: '/downloads/movie.mkv', name: 'movie.mkv', size: 100, extension: 'mkv' });

    expect(mockClient.deleteQueueItem).toHaveBeenCalledWith(42, {
      blocklist: false,
      removeFromClient: true,
    });
  });

  it('does nothing when no matching queue item is found', async () => {
    const filter = makeFilter({ action_payload: 'blocklist_and_search', instance_id: 1 });
    const config = makeInstanceConfig({ type: 'sonarr' });
    mockGetInstanceConfigById.mockReturnValue(config);

    const mockClient = Object.create(SonarrClient.prototype);
    mockClient.getQueue = vi.fn().mockResolvedValue({ records: [] });
    mockClient.blocklistAndRemove = vi.fn();
    mockClient.deleteQueueItem = vi.fn();
    mockCreateArrClient.mockReturnValue(mockClient);

    await (engine as any).handleBlocklist(filter, { path: '/other/test.exe', name: 'test.exe', size: 100, extension: 'exe' });

    expect(mockClient.blocklistAndRemove).not.toHaveBeenCalled();
    expect(mockClient.deleteQueueItem).not.toHaveBeenCalled();
  });

  it('returns early when no instance_id is set', async () => {
    const filter = makeFilter({ instance_id: null });

    await (engine as any).handleBlocklist(filter, { path: '/downloads/test.exe', name: 'test.exe', size: 100, extension: 'exe' });

    expect(mockCreateArrClient).not.toHaveBeenCalled();
  });
});
