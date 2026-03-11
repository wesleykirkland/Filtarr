import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  getAllInstances: vi.fn(), getInstanceConfigById: vi.fn(), createArrClient: vi.fn(), recordActivityEvent: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

vi.mock('../../src/db/schemas/instances.js', () => ({ getAllInstances: state.getAllInstances, getInstanceConfigById: state.getInstanceConfigById }));
vi.mock('../../src/server/routes/instances.js', () => ({ createArrClient: state.createArrClient }));
vi.mock('../../src/server/lib/activity.js', () => ({ recordActivityEvent: state.recordActivityEvent }));
vi.mock('../../src/server/lib/logger.js', () => ({ logger: state.logger }));

import { startInstanceValidator, stopInstanceValidator } from '../../src/server/cron/instanceValidator.js';

const makeDb = (value: string | Error) => ({ prepare: vi.fn().mockReturnValue({ get: () => { if (value instanceof Error) throw value; return { value }; } }) }) as never;
const validationMessages = () => state.recordActivityEvent.mock.calls.map(([, event]) => event.message);

describe('instance validator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    [state.getAllInstances, state.getInstanceConfigById, state.createArrClient, state.recordActivityEvent].forEach((mock) => mock.mockReset());
    Object.values(state.logger).forEach((mock) => mock.mockReset());
  });

  afterEach(() => {
    stopInstanceValidator();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('validates enabled instances and reschedules using the configured interval', async () => {
    const db = makeDb('15');
    state.getAllInstances.mockReturnValueOnce([
      { id: 1, name: 'Healthy', type: 'sonarr', enabled: 1 },
      { id: 2, name: 'Disabled', type: 'radarr', enabled: 0 },
      { id: 3, name: 'Denied', type: 'lidarr', enabled: 1 },
      { id: 4, name: 'Crashy', type: 'sonarr', enabled: 1 },
      { id: 5, name: 'Missing config', type: 'sonarr', enabled: 1 },
    ]).mockReturnValue([]);
    state.getInstanceConfigById.mockImplementation((_db, id: number) => ({
      1: { id: 1, type: 'sonarr', url: 'https://one', apiKey: 'a', timeout: 1000, skipSslVerify: false },
      3: { id: 3, type: 'lidarr', url: 'https://three', apiKey: 'b', timeout: 1000, skipSslVerify: false },
      4: { id: 4, type: 'sonarr', url: 'https://four', apiKey: 'c', timeout: 1000, skipSslVerify: false },
    }[id] ?? null));
    state.createArrClient
      .mockReturnValueOnce({ testConnection: vi.fn().mockResolvedValue({ success: true }) })
      .mockReturnValueOnce({ testConnection: vi.fn().mockResolvedValue({ success: false, error: 'denied' }) })
      .mockReturnValueOnce({ testConnection: vi.fn().mockRejectedValue(new Error('boom')) });

    startInstanceValidator(db);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(state.createArrClient).toHaveBeenCalledTimes(3);
    expect(validationMessages()).toEqual(expect.arrayContaining([
      'Scheduled validation succeeded for Healthy',
      'Scheduled validation failed for Denied',
      'Scheduled validation crashed for Crashy',
    ]));

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(state.getAllInstances).toHaveBeenCalledTimes(2);
  });

  it('falls back to the default interval and stops scheduling when shut down', async () => {
    const db = makeDb('not-a-number');
    state.getAllInstances.mockReturnValue([{ id: 1, name: 'Only', type: 'sonarr', enabled: 1 }]);
    state.getInstanceConfigById.mockReturnValue({ id: 1, type: 'sonarr', url: 'https://one', apiKey: 'a', timeout: 1000, skipSslVerify: false });
    state.createArrClient.mockReturnValue({ testConnection: vi.fn().mockResolvedValue({ success: true }) });

    startInstanceValidator(db);
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(state.getAllInstances).toHaveBeenCalledTimes(2);

    stopInstanceValidator();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(state.getAllInstances).toHaveBeenCalledTimes(2);
  });
});