import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/server/services/watcher.js', () => ({ reloadWatcher: vi.fn() }));
vi.mock('../../src/server/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { resetConfigCache } from '../../src/config/index.js';
import { runMigrations } from '../../src/db/migrate.js';
import { createInstance } from '../../src/db/schemas/instances.js';
import { createFiltersRoutes } from '../../src/server/routes/filters.js';

describe('filters routes: blocklist actionPayload', () => {
  let db: Database.Database;
  let app: express.Express;
  let instanceId: number;

  const baseBody = () => ({
    name: 'Block EXE',
    triggerSource: 'watcher',
    ruleType: 'extension',
    rulePayload: 'exe',
    actionType: 'blocklist',
    targetPath: '/downloads',
    instanceId,
  });

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    instanceId = createInstance(db, {
      name: 'Sonarr',
      type: 'sonarr',
      url: 'http://localhost:8989',
      apiKey: 'test-api-key',
    }).id;
    app = express();
    app.use(express.json());
    app.use('/', createFiltersRoutes(db));
  });

  afterEach(() => {
    db.close();
  });

  it('defaults a missing actionPayload to blocklist_and_search on create', async () => {
    const res = await request(app).post('/').send(baseBody());
    expect(res.status).toBe(201);
    expect(res.body.action_payload).toBe('blocklist_and_search');
  });

  it('defaults an empty actionPayload to blocklist_and_search on create', async () => {
    const res = await request(app).post('/').send({ ...baseBody(), actionPayload: '' });
    expect(res.status).toBe(201);
    expect(res.body.action_payload).toBe('blocklist_and_search');
  });

  it('accepts a valid behavior on create', async () => {
    const res = await request(app).post('/').send({ ...baseBody(), actionPayload: 'blocklist_only' });
    expect(res.status).toBe(201);
    expect(res.body.action_payload).toBe('blocklist_only');
  });

  it('rejects an unknown behavior on create', async () => {
    const res = await request(app).post('/').send({ ...baseBody(), actionPayload: 'garbage' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('actionPayload must be one of');
  });

  it('does not constrain actionPayload for non-blocklist actions', async () => {
    const res = await request(app)
      .post('/')
      .send({ ...baseBody(), actionType: 'move', actionPayload: '/mnt/quarantine' });
    expect(res.status).toBe(201);
    expect(res.body.action_payload).toBe('/mnt/quarantine');
  });

  describe('updates', () => {
    let legacyId: number;

    beforeEach(() => {
      const info = db
        .prepare(
          `INSERT INTO filters (name, trigger_source, rule_type, rule_payload, action_type, action_payload, target_path, instance_id)
           VALUES ('Legacy', 'watcher', 'extension', 'exe', 'blocklist', NULL, '/downloads', ?)`,
        )
        .run(instanceId);
      legacyId = Number(info.lastInsertRowid);
    });

    it('defaults the payload when a legacy row is updated without one', async () => {
      const res = await request(app).put(`/${legacyId}`).send({ actionType: 'blocklist' });
      expect(res.status).toBe(200);
      expect(res.body.action_payload).toBe('blocklist_and_search');
    });

    it('allows a partial update that does not touch the action', async () => {
      const res = await request(app).put(`/${legacyId}`).send({ enabled: false });
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(0);
      expect(res.body.action_payload).toBeNull();
    });

    it('rejects an unknown behavior on update', async () => {
      const res = await request(app)
        .put(`/${legacyId}`)
        .send({ actionType: 'blocklist', actionPayload: 'do_not_blocklist' });
      expect(res.status).toBe(400);
    });

    it('clears description and actionPayload when sent as empty strings', async () => {
      await request(app).put(`/${legacyId}`).send({ description: 'old', actionType: 'move', actionPayload: '/mnt/x' });
      const res = await request(app)
        .put(`/${legacyId}`)
        .send({ description: '', actionType: 'delete', actionPayload: '' });
      expect(res.status).toBe(200);
      expect(res.body.description).toBeNull();
      expect(res.body.action_payload).toBeNull();
    });
  });
});

describe('filters routes: path, rule and trigger validation', () => {
  let db: Database.Database;
  let app: express.Express;
  let dataDir: string;
  let browseRoot: string;

  const body = (overrides: Record<string, unknown> = {}) => ({
    name: `Filter ${Math.random()}`,
    triggerSource: 'watcher',
    ruleType: 'extension',
    rulePayload: 'exe',
    actionType: 'delete',
    targetPath: '/downloads',
    ...overrides,
  });

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filtarr-filters-data-'));
    browseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filtarr-filters-root-'));
    process.env['FILTARR_DATA_DIR'] = dataDir;
    resetConfigCache();
    db = new Database(':memory:');
    runMigrations(db);
    app = express();
    app.use(express.json());
    app.use('/', createFiltersRoutes(db));
  });

  afterEach(() => {
    db.close();
    delete process.env['FILTARR_DATA_DIR'];
    delete process.env['FILTARR_BROWSE_ROOT'];
    resetConfigCache();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(browseRoot, { recursive: true, force: true });
  });

  it('accepts a normal absolute target path', async () => {
    const res = await request(app).post('/').send(body({ targetPath: ' /downloads/complete ' }));
    expect(res.status).toBe(201);
    expect(res.body.target_path).toBe('/downloads/complete');
  });

  it.each(['/', '/etc', '/etc/ssl', '/proc/self', '/usr', '/var', '/root', 'relative/path'])(
    'rejects target path %s',
    async (targetPath) => {
      const res = await request(app).post('/').send(body({ targetPath }));
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Target path/);
    },
  );

  it('rejects the data dir, its children and its ancestors as target or move destination', async () => {
    for (const targetPath of [dataDir, path.join(dataDir, 'backups'), path.dirname(dataDir)]) {
      const res = await request(app).post('/').send(body({ targetPath }));
      expect(res.status).toBe(400);
    }
    const move = await request(app)
      .post('/')
      .send(body({ actionType: 'move', actionPayload: path.join(dataDir, 'quarantine') }));
    expect(move.status).toBe(400);
    expect(move.body.error).toContain('Move destination');
  });

  it('requires an absolute, permitted move destination', async () => {
    for (const actionPayload of [undefined, '', 'quarantine', '/', '/etc/cron.d']) {
      const res = await request(app).post('/').send(body({ actionType: 'move', actionPayload }));
      expect(res.status).toBe(400);
    }
  });

  it('confines target path and move destination to FILTARR_BROWSE_ROOT when set', async () => {
    process.env['FILTARR_BROWSE_ROOT'] = browseRoot;
    const outside = await request(app).post('/').send(body({ targetPath: '/downloads' }));
    expect(outside.status).toBe(400);
    expect(outside.body.error).toContain('FILTARR_BROWSE_ROOT');

    const escapedMove = await request(app)
      .post('/')
      .send(body({ targetPath: path.join(browseRoot, 'in'), actionType: 'move', actionPayload: '/mnt/out' }));
    expect(escapedMove.status).toBe(400);

    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filtarr-filters-outside-'));
    try {
      fs.symlinkSync(outsideDir, path.join(browseRoot, 'link'));
      const viaSymlink = await request(app).post('/').send(body({ targetPath: path.join(browseRoot, 'link', 'x') }));
      expect(viaSymlink.status).toBe(400);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }

    const inside = await request(app)
      .post('/')
      .send(body({ targetPath: path.join(browseRoot, 'in'), actionType: 'move', actionPayload: path.join(browseRoot, 'q') }));
    expect(inside.status).toBe(201);
  });

  it('requires a target path for watcher and cron filters but not manual ones', async () => {
    for (const triggerSource of ['watcher', 'cron']) {
      const res = await request(app).post('/').send(body({ triggerSource, targetPath: undefined }));
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Target path is required');
    }
    const manual = await request(app).post('/').send(body({ triggerSource: 'manual', targetPath: undefined }));
    expect(manual.status).toBe(201);
  });

  it('validates paths on update against the merged filter state', async () => {
    const manual = await request(app).post('/').send(body({ triggerSource: 'manual', targetPath: undefined }));
    expect((await request(app).put(`/${manual.body.id}`).send({ enabled: false })).status).toBe(200);
    expect((await request(app).put(`/${manual.body.id}`).send({ triggerSource: 'cron' })).status).toBe(400);
    expect((await request(app).put(`/${manual.body.id}`).send({ targetPath: '/' })).status).toBe(400);
    expect((await request(app).put(`/${manual.body.id}`).send({ actionType: 'move' })).status).toBe(400);
    const ok = await request(app).put(`/${manual.body.id}`).send({ triggerSource: 'cron', targetPath: '/downloads' });
    expect(ok.status).toBe(200);
    expect(ok.body.trigger_source).toBe('cron');
  });

  it('rejects overlong, invalid and nested-quantifier regex payloads', async () => {
    for (const rulePayload of ['a'.repeat(257), '(unclosed', '(a+)+$', '(a*)*b', '(a|aa)+', String.raw`(\w)\1`]) {
      const res = await request(app).post('/').send(body({ ruleType: 'regex', rulePayload }));
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Regex rule/);
    }
    const ok = await request(app)
      .post('/')
      .send(body({ ruleType: 'regex', rulePayload: String.raw`(^|[.\-_ ])sample\.(mkv|mp4)$` }));
    expect(ok.status).toBe(201);
  });

  it('normalizes size payloads and rejects malformed ones', async () => {
    const ok = await request(app).post('/').send(body({ ruleType: 'size', rulePayload: ' > 1.5 g ' }));
    expect(ok.status).toBe(201);
    expect(ok.body.rule_payload).toBe('>1.5GB');
    for (const rulePayload of ['100', 'big', '>100 PB', '>>1MB', '-1MB']) {
      const res = await request(app).post('/').send(body({ ruleType: 'size', rulePayload }));
      expect(res.status).toBe(400);
    }
  });

  it('normalizes extension payloads and rejects malformed ones', async () => {
    const ok = await request(app).post('/').send(body({ rulePayload: ' .MKV, ,mp4,, ' }));
    expect(ok.status).toBe(201);
    expect(ok.body.rule_payload).toBe('mkv,mp4');
    for (const rulePayload of [',', ' , . ', 'tar.gz', 'mk v']) {
      const res = await request(app).post('/').send(body({ rulePayload }));
      expect(res.status).toBe(400);
    }
  });

  it('validates a rule payload update against the stored rule type', async () => {
    const created = await request(app).post('/').send(body({ ruleType: 'size', rulePayload: '>1GB' }));
    expect((await request(app).put(`/${created.body.id}`).send({ rulePayload: 'huge' })).status).toBe(400);
    const res = await request(app).put(`/${created.body.id}`).send({ rulePayload: '<10m' });
    expect(res.status).toBe(200);
    expect(res.body.rule_payload).toBe('<10MB');
  });
});
