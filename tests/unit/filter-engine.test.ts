import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilterRow } from '../../src/db/schemas/filters.js';

const state = vi.hoisted(() => ({
  fs: {
    statSync: vi.fn(),
    existsSync: vi.fn(),
    unlinkSync: vi.fn(),
    mkdirSync: vi.fn(),
    renameSync: vi.fn(),
  },
  getAllFilters: vi.fn(),
  getInstanceConfigById: vi.fn(),
  recordActivityEvent: vi.fn(),
  createArrClient: vi.fn(),
  runSandboxedScript: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('node:fs', () => ({ default: state.fs }));
vi.mock('../../src/db/schemas/filters.js', () => ({ getAllFilters: state.getAllFilters }));
vi.mock('../../src/db/schemas/instances.js', () => ({ getInstanceConfigById: state.getInstanceConfigById }));
vi.mock('../../src/server/lib/activity.js', () => ({ recordActivityEvent: state.recordActivityEvent }));
vi.mock('../../src/server/routes/instances.js', () => ({ createArrClient: state.createArrClient }));
vi.mock('../../src/server/services/scriptRunner.js', () => ({ runSandboxedScript: state.runSandboxedScript }));
vi.mock('../../src/server/lib/logger.js', () => ({ logger: state.logger }));

import * as security from '../../src/services/security.js';
import { FilterEngine } from '../../src/server/services/filterEngine.js';

const db = {} as never;
const file = { path: '/downloads/movie.mkv', name: 'movie.mkv', size: 5 * 1024 * 1024, extension: 'mkv' };
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const makeFilter = (overrides: Partial<FilterRow> = {}): FilterRow => ({
  id: 1,
  name: 'Test Filter',
  description: null,
  trigger_source: 'watcher',
  rule_type: 'extension',
  rule_payload: 'mkv',
  action_type: 'delete',
  action_payload: null,
  target_path: null,
  is_built_in: 0,
  notify_on_match: 0,
  notify_webhook_url: null,
  notify_slack: 0,
  notify_slack_token: null,
  notify_slack_channel: null,
  instance_id: null,
  enabled: 1,
  sort_order: 0,
  created_at: '',
  updated_at: '',
  ...overrides,
});

describe('FilterEngine', () => {
  beforeEach(() => {
    Object.values(state.fs).forEach((mock) => mock.mockReset());
    [
      state.getAllFilters,
      state.getInstanceConfigById,
      state.recordActivityEvent,
      state.createArrClient,
      state.runSandboxedScript,
    ].forEach((mock) => mock.mockReset());
    Object.values(state.logger).forEach((mock) => mock.mockReset());
    globalThis.fetch = vi.fn() as typeof fetch;
    state.fs.statSync.mockReturnValue({ size: file.size });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('evaluates size rules across operators and invalid payloads', () => {
    const engine = new FilterEngine(db) as any;

    expect(engine.evaluateSizeRule('>1KB', 2048)).toBe(true);
    expect(engine.evaluateSizeRule('<2KB', 1024)).toBe(true);
    expect(engine.evaluateSizeRule('5MB', 5 * 1024 * 1024)).toBe(true);
    expect(engine.evaluateSizeRule('512', 512)).toBe(true);
    expect(engine.evaluateSizeRule('bad-size', 1024)).toBe(false);
  });

  it('matches target paths and supported rule types', async () => {
    const engine = new FilterEngine(db) as any;
    state.runSandboxedScript.mockResolvedValueOnce({ success: true, output: 'yes' });
    state.runSandboxedScript.mockResolvedValueOnce({ success: true, output: 0 });

    expect(await engine.matches(makeFilter({ target_path: '/other' }), file)).toBe(false);
    expect(await engine.matches(makeFilter({ rule_type: 'extension', rule_payload: 'avi, mkv' }), file)).toBe(true);
    expect(await engine.matches(makeFilter({ rule_type: 'regex', rule_payload: String.raw`movie\.mkv` }), file)).toBe(true);
    expect(await engine.matches(makeFilter({ rule_type: 'regex', rule_payload: null as never }), file)).toBe(true);
    expect(await engine.matches(makeFilter({ rule_type: 'size', rule_payload: '>1MB' }), file)).toBe(true);
    expect(await engine.matches(makeFilter({ rule_type: 'script', rule_payload: 'return true;' }), file)).toBe(true);
    expect(await engine.matches(makeFilter({ rule_type: 'script', rule_payload: 'return 0;' }), file)).toBe(false);
    expect(await engine.matches(makeFilter({ rule_type: 'unknown' }), file)).toBe(false);
  });

  it('returns early when the file can no longer be statted', async () => {
    const engine = new FilterEngine(db);
    const error = new Error('gone');
    state.fs.statSync.mockImplementation(() => {
      throw error;
    });

    await engine.processFile('/downloads/missing.mkv');

    expect(state.getAllFilters).not.toHaveBeenCalled();
    expect(state.logger.debug).toHaveBeenCalledWith(
      { filePath: '/downloads/missing.mkv', err: error },
      'Could not stat file, it might have been moved or deleted already',
    );
  });

  it('processes matched filters, sends notifications, and isolates filter failures', async () => {
    const engine = new FilterEngine(db);
    const badRuleError = new Error('rule exploded');
    state.getAllFilters.mockReturnValue([
      makeFilter({ id: 1, name: 'Delete Match', notify_on_match: 1, notify_webhook_url: 'https://example.com/hook' }),
      makeFilter({ id: 2, name: 'Broken Rule', rule_type: 'script', rule_payload: 'throw new Error()' }),
      makeFilter({ id: 3, name: 'Disabled', enabled: 0 }),
    ]);
    state.fs.existsSync.mockImplementation((target: string) => target === file.path);
    state.runSandboxedScript.mockRejectedValueOnce(badRuleError);
    vi.mocked(globalThis.fetch).mockResolvedValue({ ok: true, status: 204 } as Response);

    await engine.processFile(file.path, 'manual');

    expect(state.fs.unlinkSync).toHaveBeenCalledWith(file.path);
    expect(state.recordActivityEvent).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        type: 'matched',
        message: 'Filter "Delete Match" matched movie.mkv',
        details: expect.objectContaining({ trigger: 'manual', actionType: 'delete' }),
      }),
    );
    expect(state.recordActivityEvent).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        type: 'notification',
        message: 'Notification sent for filter "Delete Match"',
        details: expect.objectContaining({ success: true, status: 204 }),
      }),
    );
    expect(state.logger.error).toHaveBeenCalledWith(
      { filterId: 2, err: 'rule exploded' },
      'Error processing filter',
    );
  });

  it('executes move and script actions and ignores notify as a primary no-op action', async () => {
    const engine = new FilterEngine(db) as any;
    state.fs.existsSync.mockImplementation((target: string) => target === file.path);

    await engine.executeAction(makeFilter({ id: 4, name: 'Move It', action_type: 'move', action_payload: '/archive' }), file);

    expect(state.fs.mkdirSync).toHaveBeenCalledWith('/archive', { recursive: true });
    expect(state.fs.renameSync).toHaveBeenCalledWith(file.path, '/archive/movie.mkv');
    expect(state.recordActivityEvent).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        type: 'action',
        message: 'Moved movie.mkv via filter "Move It"',
        details: expect.objectContaining({ actionType: 'move', destinationPath: '/archive/movie.mkv' }),
      }),
    );

    state.runSandboxedScript.mockResolvedValueOnce({ success: true, output: 1 });
    await engine.executeAction(makeFilter({ id: 5, name: 'Script It', action_type: 'script', action_payload: 'return 1;' }), file);
    await engine.executeAction(makeFilter({ id: 6, name: 'Notify Only', action_type: 'notify' }), file);

    expect(state.runSandboxedScript).toHaveBeenCalledWith('return 1;', {
      file,
      filter: expect.objectContaining({ id: 5, name: 'Script It' }),
    });
  });

  it('leaves delete, move, and script actions untouched when prerequisites are missing', async () => {
    const engine = new FilterEngine(db) as any;
    state.fs.existsSync.mockReturnValue(false);

    await engine.executeAction(makeFilter({ id: 17, name: 'Delete Missing', action_type: 'delete' }), file);
    await engine.executeAction(makeFilter({ id: 18, name: 'Move Missing', action_type: 'move', action_payload: '/archive' }), file);
    await engine.executeAction(makeFilter({ id: 19, name: 'Move Without Target', action_type: 'move', action_payload: null }), file);
    await engine.executeAction(makeFilter({ id: 20, name: 'Script Without Payload', action_type: 'script', action_payload: null }), file);

    expect(state.fs.unlinkSync).not.toHaveBeenCalled();
    expect(state.fs.mkdirSync).not.toHaveBeenCalled();
    expect(state.fs.renameSync).not.toHaveBeenCalled();
    expect(state.runSandboxedScript).not.toHaveBeenCalled();
    expect(state.recordActivityEvent).not.toHaveBeenCalled();
  });

  it('moves files without recreating an existing destination directory', async () => {
    const engine = new FilterEngine(db) as any;
    state.fs.existsSync.mockImplementation((target: string) => target === file.path || target === '/archive');

    await engine.executeAction(makeFilter({ id: 21, name: 'Move Existing Dir', action_type: 'move', action_payload: '/archive' }), file);

    expect(state.fs.mkdirSync).not.toHaveBeenCalled();
    expect(state.fs.renameSync).toHaveBeenCalledWith(file.path, '/archive/movie.mkv');
  });

  it('skips or fails blocklisting when no linked instance is available', async () => {
    const engine = new FilterEngine(db) as any;

    await engine.handleBlocklist(makeFilter({ id: 7, name: 'No Instance', action_type: 'blocklist' }), file);
    await engine.handleBlocklist(makeFilter({ id: 8, name: 'Missing Config', action_type: 'blocklist', instance_id: 99 }), file);

    expect(state.logger.warn).toHaveBeenCalledWith(
      { filterId: 7 },
      'Blocklist action triggered but no instance linked',
    );
    expect(state.logger.error).toHaveBeenCalledWith(
      { filterId: 8, instanceId: 99 },
      'Linked instance config not found',
    );
    expect(state.recordActivityEvent).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        message: 'Blocklist action skipped for filter "No Instance" because no instance is linked',
        details: expect.objectContaining({ status: 'skipped' }),
      }),
    );
    expect(state.recordActivityEvent).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        message: 'Blocklist action failed for filter "Missing Config" because the linked instance no longer exists',
        details: expect.objectContaining({ status: 'failure', instanceId: 99 }),
      }),
    );
  });

  it('blocklists matching queue items, skips missing matches, and records client failures', async () => {
    const engine = new FilterEngine(db) as any;
    const filter = makeFilter({ id: 9, name: 'Queue Filter', action_type: 'blocklist', instance_id: 4 });
    const translatedFile = { ...file, path: '/downloads/nested/movie.mkv', name: 'movie.mkv' };
    const blocklistAndRemove = vi.fn().mockResolvedValue(undefined);
    state.getInstanceConfigById.mockReturnValue({
      id: 4,
      name: 'Sonarr',
      type: 'sonarr',
      url: 'https://arr.example',
      apiKey: 'key',
      timeout: 1000,
      skipSslVerify: false,
      localPath: '/downloads',
      remotePath: '/remote',
    });
    state.createArrClient
      .mockReturnValueOnce({
        getQueue: vi.fn().mockResolvedValue({ records: [{ id: 12, title: 'Movie', outputPath: '/remote/nested' }] }),
        blocklistAndRemove,
      })
      .mockReturnValueOnce({
        getQueue: vi.fn().mockResolvedValue({ records: [{ id: 13, title: 'Elsewhere', outputPath: '/other/path' }] }),
        blocklistAndRemove: vi.fn(),
      })
      .mockReturnValueOnce({
        getQueue: vi.fn().mockRejectedValue(new Error('queue offline')),
        blocklistAndRemove: vi.fn(),
      });

    await engine.handleBlocklist(filter, translatedFile);
    await engine.handleBlocklist(filter, translatedFile);
    await engine.handleBlocklist(filter, translatedFile);

    expect(blocklistAndRemove).toHaveBeenCalledWith(12);
    expect(state.recordActivityEvent).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ details: expect.objectContaining({ status: 'success', queueItemId: 12 }) }),
    );
    expect(state.recordActivityEvent).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ details: expect.objectContaining({ status: 'skipped', instanceId: 4 }) }),
    );
    expect(state.recordActivityEvent).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ details: expect.objectContaining({ status: 'failure', error: 'queue offline' }) }),
    );
  });

  it('dispatches blocklist actions through executeAction and falls back to the local path when no mapping applies', async () => {
    const engine = new FilterEngine(db) as any;
    const blocklistAndRemove = vi.fn().mockResolvedValue(undefined);
    state.getInstanceConfigById.mockReturnValue({
      id: 5,
      name: 'Radarr',
      type: 'radarr',
      url: 'https://arr.example',
      apiKey: 'key',
      timeout: 1000,
      skipSslVerify: false,
      localPath: '/elsewhere',
      remotePath: '/remote',
    });
    state.createArrClient.mockReturnValue({
      getQueue: vi.fn().mockResolvedValue({
        records: [
          { id: 14, title: 'No Output Path' },
          { id: 15, title: 'Movie', outputPath: '/downloads' },
        ],
      }),
      blocklistAndRemove,
    });

    await engine.executeAction(makeFilter({ id: 15, name: 'Execute Blocklist', action_type: 'blocklist', instance_id: 5 }), file);

    expect(blocklistAndRemove).toHaveBeenCalledWith(15);
    expect(state.recordActivityEvent).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        message: 'Blocklisted "Movie" via filter "Execute Blocklist"',
        details: expect.objectContaining({ actionType: 'blocklist', status: 'success', instanceId: 5, queueItemId: 15 }),
      }),
    );
  });

  it('falls back to the original file path when blocklist path mapping is not configured', async () => {
    const engine = new FilterEngine(db) as any;
    const blocklistAndRemove = vi.fn().mockResolvedValue(undefined);
    state.getInstanceConfigById.mockReturnValue({
      id: 6,
      name: 'Sonarr',
      type: 'sonarr',
      url: 'https://arr.example',
      apiKey: 'key',
      timeout: 1000,
      skipSslVerify: false,
      localPath: '/downloads',
      remotePath: null,
    });
    state.createArrClient.mockReturnValue({
      getQueue: vi.fn().mockResolvedValue({ records: [{ id: 22, title: 'Movie', outputPath: '/downloads' }] }),
      blocklistAndRemove,
    });

    await engine.handleBlocklist(makeFilter({ id: 22, name: 'Unmapped Queue Filter', action_type: 'blocklist', instance_id: 6 }), file);

    expect(blocklistAndRemove).toHaveBeenCalledWith(22);
  });

  it('validates webhook targets and records success, failure, and thrown notification outcomes', async () => {
    const engine = new FilterEngine(db) as any;

    await engine.sendNotification(makeFilter({ id: 10, notify_webhook_url: null }), file);
    await engine.sendNotification(makeFilter({ id: 11, notify_webhook_url: 'http://127.0.0.1/hook' }), file);

    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response)
      .mockResolvedValueOnce({ ok: true, status: 202 } as Response)
      .mockRejectedValueOnce(new Error('offline'));

    await engine.sendNotification(makeFilter({ id: 12, name: 'Failure Hook', notify_webhook_url: 'https://example.com/fail' }), file);
    await engine.sendNotification(makeFilter({ id: 13, name: 'Success Hook', notify_webhook_url: 'https://example.com/success' }), file);
    await engine.sendNotification(makeFilter({ id: 14, name: 'Error Hook', notify_webhook_url: 'https://example.com/error' }), file);
    await flush();

    expect(state.logger.warn).toHaveBeenCalledWith(
      { filterId: 11, error: expect.any(String) },
      'Blocked unsafe notification webhook',
    );
    expect(state.recordActivityEvent).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ message: 'Notification delivery failed for filter "Failure Hook"' }),
    );
    expect(state.recordActivityEvent).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ message: 'Notification sent for filter "Success Hook"' }),
    );
    expect(state.recordActivityEvent).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ message: 'Notification errored for filter "Error Hook"' }),
    );
    expect(state.logger.error).toHaveBeenCalledWith(
      { filterId: 14, err: 'offline' },
      'Error sending webhook notification',
    );
    expect(security.SecurityPolicyError).toBeTypeOf('function');
  });

  it('rethrows unexpected webhook validation failures', async () => {
    const engine = new FilterEngine(db) as any;
    const validatorError = new Error('validator exploded');
    vi.spyOn(security, 'validateWebhookUrl').mockImplementationOnce(() => {
      throw validatorError;
    });

    await expect(
      engine.sendNotification(makeFilter({ id: 16, notify_webhook_url: 'https://example.com/hook' }), file),
    ).rejects.toThrow('validator exploded');

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
