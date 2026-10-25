import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/server/services/watcher.js', () => ({ reloadWatcher: vi.fn() }));
vi.mock('../../src/server/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

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
