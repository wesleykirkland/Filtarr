import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilterRow } from '../../src/db/schemas/filters.js';

const state = vi.hoisted(() => ({ filters: [] as unknown[] }));

vi.mock('../../src/db/schemas/filters.js', () => ({ getAllFilters: vi.fn(() => state.filters) }));
vi.mock('../../src/db/schemas/instances.js', () => ({ getInstanceConfigById: vi.fn() }));
vi.mock('../../src/server/routes/instances.js', () => ({ createArrClient: vi.fn() }));
vi.mock('../../src/server/lib/activity.js', () => ({ recordActivityEvent: vi.fn() }));
vi.mock('../../src/server/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
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

import { resetConfigCache } from '../../src/config/index.js';
import { recordActivityEvent } from '../../src/server/lib/activity.js';
import { FilterEngine, MAX_REGEX_SUBJECT_LENGTH } from '../../src/server/services/filterEngine.js';

function makeFilter(overrides: Partial<FilterRow> = {}): FilterRow {
  return {
    id: 1,
    name: 'Test Filter',
    description: null,
    trigger_source: 'cron',
    rule_type: 'extension',
    rule_payload: 'mkv',
    action_type: 'delete',
    action_payload: null,
    script_runtime: 'shell',
    target_path: null,
    is_built_in: 0,
    notify_on_match: 0,
    notify_webhook_url: null,
    notify_slack: 0,
    notify_slack_token: null,
    notify_slack_channel: null,
    override_notifications: 0,
    instance_id: null,
    enabled: 1,
    sort_order: 0,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    ...overrides,
  };
}

describe('FilterEngine file actions and rule evaluation', () => {
  let root: string;
  let target: string;
  let outside: string;
  let dataDir: string;
  let engine: FilterEngine;

  const write = (file: string, content = 'x') => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return file;
  };

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'filtarr-engine-')));
    target = path.join(root, 'downloads');
    outside = path.join(root, 'outside');
    dataDir = path.join(root, 'data');
    fs.mkdirSync(target);
    fs.mkdirSync(outside);
    process.env['FILTARR_DATA_DIR'] = dataDir;
    resetConfigCache();
    engine = new FilterEngine({} as Database.Database);
    vi.mocked(recordActivityEvent).mockClear();
  });

  afterEach(() => {
    delete process.env['FILTARR_DATA_DIR'];
    resetConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('deletes a matching file inside the target path', async () => {
    const file = write(path.join(target, 'movie.mkv'));
    state.filters = [makeFilter({ target_path: target })];
    await engine.processFile(file, 'cron');
    expect(fs.existsSync(file)).toBe(false);
  });

  it('skips delete when a symlinked directory escapes the target path', async () => {
    const victim = write(path.join(outside, 'victim.mkv'));
    fs.symlinkSync(outside, path.join(target, 'escape'));
    state.filters = [makeFilter({ target_path: target })];

    await engine.processFile(path.join(target, 'escape', 'victim.mkv'), 'cron');

    expect(fs.existsSync(victim)).toBe(true);
  });

  it('skips move when a symlinked directory escapes the target path', async () => {
    const victim = write(path.join(outside, 'victim.mkv'));
    fs.symlinkSync(outside, path.join(target, 'escape'));
    const quarantine = path.join(root, 'quarantine');
    state.filters = [makeFilter({ target_path: target, action_type: 'move', action_payload: quarantine })];

    await engine.processFile(path.join(target, 'escape', 'victim.mkv'), 'cron');

    expect(fs.existsSync(victim)).toBe(true);
    expect(fs.existsSync(path.join(quarantine, 'victim.mkv'))).toBe(false);
  });

  it('moves a file and never overwrites an existing destination', async () => {
    const quarantine = path.join(root, 'quarantine');
    state.filters = [makeFilter({ target_path: target, action_type: 'move', action_payload: quarantine })];

    const first = write(path.join(target, 'movie.mkv'), 'first');
    await engine.processFile(first, 'cron');
    expect(fs.readFileSync(path.join(quarantine, 'movie.mkv'), 'utf8')).toBe('first');

    const second = write(path.join(target, 'movie.mkv'), 'second');
    await engine.processFile(second, 'cron');
    expect(fs.readFileSync(path.join(quarantine, 'movie.mkv'), 'utf8')).toBe('first');
    expect(fs.readFileSync(second, 'utf8')).toBe('second');
    expect(recordActivityEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source: 'filters', details: expect.objectContaining({ status: 'skipped' }) }),
    );
  });

  it('refuses to move into a blocked destination such as the data dir', async () => {
    const file = write(path.join(target, 'movie.mkv'));
    state.filters = [makeFilter({ target_path: target, action_type: 'move', action_payload: path.join(dataDir, 'q') })];
    await engine.processFile(file, 'cron');
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.existsSync(path.join(dataDir, 'q'))).toBe(false);
  });

  it('never matches cron or watcher filters without a target path or with a blocked one', async () => {
    const file = write(path.join(target, 'movie.mkv'));
    state.filters = [
      makeFilter({ id: 1, trigger_source: 'cron', target_path: null }),
      makeFilter({ id: 2, trigger_source: 'cron', target_path: '/' }),
      makeFilter({ id: 3, trigger_source: 'watcher', target_path: '' }),
    ];
    await engine.processFile(file, 'cron');
    await engine.processFile(file, 'watcher');
    expect(fs.existsSync(file)).toBe(true);
  });

  it('only evaluates the requested filter ids', async () => {
    const file = write(path.join(target, 'movie.mkv'));
    state.filters = [makeFilter({ id: 7, target_path: target })];
    await engine.processFile(file, 'cron', { filterIds: [8] });
    expect(fs.existsSync(file)).toBe(true);
  });

  it('does not let a trailing comma in an extension list match extensionless files', async () => {
    const file = write(path.join(target, 'README'));
    state.filters = [makeFilter({ target_path: target, rule_payload: 'mkv,' })];
    await engine.processFile(file, 'cron');
    expect(fs.existsSync(file)).toBe(true);

    const dotted = write(path.join(target, 'clip.MP4'));
    state.filters = [makeFilter({ target_path: target, rule_payload: ' .mp4 , ' })];
    await engine.processFile(dotted, 'cron');
    expect(fs.existsSync(dotted)).toBe(false);
  });

  it('evaluates normalized size rules including bare unit suffixes', async () => {
    const file = write(path.join(target, 'big.bin'), 'x'.repeat(2048));
    state.filters = [makeFilter({ target_path: target, rule_type: 'size', rule_payload: '> 1k' })];
    await engine.processFile(file, 'cron');
    expect(fs.existsSync(file)).toBe(false);
  });

  it('ignores unsafe stored regexes and overlong filenames', async () => {
    const file = write(path.join(target, 'aaaa.mkv'));
    state.filters = [makeFilter({ target_path: target, rule_type: 'regex', rule_payload: '(a+)+' })];
    await engine.processFile(file, 'cron');
    expect(fs.existsSync(file)).toBe(true);

    state.filters = [makeFilter({ id: 2, target_path: target, rule_type: 'regex', rule_payload: 'a' })];
    const longName = { path: file, name: 'a'.repeat(MAX_REGEX_SUBJECT_LENGTH + 1), size: 1, extension: 'mkv' };
    const matches = (engine as unknown as {
      matches: (f: FilterRow, file: unknown, type: string) => Promise<boolean>;
    }).matches.bind(engine);
    expect(await matches(state.filters[0] as FilterRow, longName, 'cron')).toBe(false);

    await engine.processFile(file, 'cron');
    expect(fs.existsSync(file)).toBe(false);
  });
});
