import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAllInstances: vi.fn(),
  getInstanceConfigById: vi.fn(),
  createArrClient: vi.fn(),
  testConnection: vi.fn(),
  notifyInstanceHealthcheckFailure: vi.fn(),
}));

vi.mock('../../src/db/schemas/instances.js', () => ({
  getAllInstances: mocks.getAllInstances,
  getInstanceConfigById: mocks.getInstanceConfigById,
}));

vi.mock('../../src/server/routes/instances.js', () => ({
  createArrClient: mocks.createArrClient,
}));

vi.mock('../../src/server/services/NotificationService.js', () => ({
  NotificationService: class {
    notifyInstanceHealthcheckFailure = mocks.notifyInstanceHealthcheckFailure;
  },
}));

import { startInstanceValidator, stopInstanceValidator } from '../../src/server/cron/instanceValidator.js';

describe('instance validator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.getAllInstances.mockReset();
    mocks.getInstanceConfigById.mockReset();
    mocks.createArrClient.mockReset();
    mocks.testConnection.mockReset();
    mocks.notifyInstanceHealthcheckFailure.mockReset();

    mocks.getAllInstances.mockReturnValue([
      {
        id: 7,
        name: 'Primary Sonarr',
        type: 'sonarr',
        url: 'http://sonarr.local',
        apiKey: '••••••••abcd',
        timeout: 30000,
        enabled: true,
        skipSslVerify: false,
        remotePath: null,
        localPath: null,
        createdAt: '2026-03-08T00:00:00.000Z',
        updatedAt: '2026-03-08T00:00:00.000Z',
      },
    ]);
    mocks.getInstanceConfigById.mockReturnValue({
      id: 7,
      name: 'Primary Sonarr',
      type: 'sonarr',
      url: 'http://sonarr.local',
      apiKey: 'secret-key',
      timeout: 30000,
      enabled: true,
      skipSslVerify: false,
      remotePath: null,
      localPath: null,
      createdAt: '2026-03-08T00:00:00.000Z',
      updatedAt: '2026-03-08T00:00:00.000Z',
    });
    mocks.createArrClient.mockReturnValue({
      testConnection: mocks.testConnection,
    });
  });

  afterEach(() => {
    stopInstanceValidator();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('uses a 15-minute default interval and notifies on failed healthchecks', async () => {
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    mocks.testConnection.mockResolvedValue({ success: false, error: 'Unauthorized' });

    const db = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      }),
    } as any;

    startInstanceValidator(db);

    expect(setTimeoutSpy).toHaveBeenNthCalledWith(1, expect.any(Function), 10_000);

    await vi.advanceTimersByTimeAsync(10_000);

    expect(mocks.notifyInstanceHealthcheckFailure).toHaveBeenCalledWith(
      {
        id: 7,
        name: 'Primary Sonarr',
        type: 'sonarr',
        url: 'http://sonarr.local',
      },
      'Unauthorized',
    );
    expect(setTimeoutSpy).toHaveBeenNthCalledWith(2, expect.any(Function), 15 * 60 * 1000);
  });
});