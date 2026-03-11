import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { resetConfigCache } from '../../src/config/index.js';
import { closeDatabase, openDatabase } from '../../src/db/index.js';

vi.mock('../../src/server/cron/scheduler.js', () => ({ reloadScheduler: vi.fn() }));
vi.mock('../../src/server/services/watcher.js', () => ({ reloadWatcher: vi.fn() }));
vi.mock('../../src/services/arr/sonarr.js', () => ({ SonarrClient: class { async testConnection() { return { success: true }; } } }));
vi.mock('../../src/services/arr/radarr.js', () => ({ RadarrClient: class { async testConnection() { return { success: true }; } } }));
vi.mock('../../src/services/arr/lidarr.js', () => ({ LidarrClient: class { async testConnection() { return { success: false, error: 'denied' }; } } }));

import { createApp } from '../../src/server/app.js';
import { reloadScheduler } from '../../src/server/cron/scheduler.js';
import { reloadWatcher } from '../../src/server/services/watcher.js';

describe('app resource flows', () => {
  let app: ReturnType<typeof createApp>;
  let db: ReturnType<typeof openDatabase>;
  let tempDir: string;

  beforeEach(() => {
    resetConfigCache();
    vi.mocked(reloadScheduler).mockClear();
    vi.mocked(reloadWatcher).mockClear();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filtarr-app-resources-'));
    process.env['FILTARR_DATA_DIR'] = tempDir;
    process.env['NODE_ENV'] = 'test';
    db = openDatabase(tempDir);
    app = createApp(db);
    db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('auth_mode', 'none', datetime('now'))`).run();
    db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('setup_complete', 'true', datetime('now'))`).run();
  });

  afterEach(() => {
    closeDatabase(db);
    resetConfigCache();
    delete process.env['FILTARR_DATA_DIR'];
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('manages directories, jobs, and events through the real app', async () => {
    const dirs = await request(app).get('/api/v1/directories');
    expect(dirs.body).toEqual([]);
    expect((await request(app).get('/api/v1/directories/abc')).status).toBe(400);
    expect((await request(app).post('/api/v1/directories').send({ path: 'relative' })).status).toBe(400);
    const dir = await request(app).post('/api/v1/directories').send({ path: '/downloads', recursive: true });
    expect(dir.status).toBe(201);
    expect((await request(app).get(`/api/v1/directories/${dir.body.id}`)).body.path).toBe('/downloads');
    expect((await request(app).post('/api/v1/directories').send({ path: '/downloads' })).status).toBe(409);
    const secondDir = await request(app).post('/api/v1/directories').send({ path: '/incoming' });
    expect(secondDir.status).toBe(201);
    expect((await request(app).put(`/api/v1/directories/${dir.body.id}`).send({ path: 'still-relative' })).status).toBe(400);
    expect((await request(app).put(`/api/v1/directories/${dir.body.id}`).send({ path: '/incoming' })).status).toBe(409);
    expect((await request(app).put(`/api/v1/directories/${dir.body.id}`).send({ enabled: false })).body.enabled).toBe(0);
    expect((await request(app).delete('/api/v1/directories/999')).status).toBe(404);
    expect((await request(app).delete(`/api/v1/directories/${secondDir.body.id}`)).body.success).toBe(true);
    expect(vi.mocked(reloadWatcher)).toHaveBeenCalledTimes(4);

    expect((await request(app).get('/api/v1/jobs/nope')).status).toBe(400);
    expect((await request(app).get('/api/v1/jobs/999')).status).toBe(404);
    expect((await request(app).post('/api/v1/jobs').send({ name: 'Script', schedule: '* * * * *', type: 'custom_script' })).status).toBe(400);
    const job = await request(app).post('/api/v1/jobs').send({ name: 'Refresh', schedule: '*/5 * * * *', type: 'built_in', payload: 'refresh' });
    expect(job.status).toBe(201);
    expect((await request(app).get(`/api/v1/jobs/${job.body.id}`)).body.name).toBe('Refresh');
    expect((await request(app).post('/api/v1/jobs').send({ name: 'Refresh', schedule: '* * * * *', type: 'built_in' })).status).toBe(409);
    const secondJob = await request(app).post('/api/v1/jobs').send({ name: 'Cleanup', schedule: '0 * * * *', type: 'filter_run', payload: '{"filterId":1}' });
    expect(secondJob.status).toBe(201);
    expect((await request(app).put('/api/v1/jobs/999').send({ enabled: false })).status).toBe(404);
    expect((await request(app).put(`/api/v1/jobs/${secondJob.body.id}`).send({ type: 'custom_script' })).status).toBe(400);
    expect((await request(app).put(`/api/v1/jobs/${secondJob.body.id}`).send({ name: 'Refresh' })).status).toBe(409);
    expect((await request(app).put(`/api/v1/jobs/${job.body.id}`).send({ enabled: false, description: 'disabled' })).body.enabled).toBe(0);
    expect((await request(app).delete(`/api/v1/jobs/${job.body.id}`)).body.success).toBe(true);
    expect((await request(app).delete(`/api/v1/jobs/${secondJob.body.id}`)).body.success).toBe(true);
    expect(vi.mocked(reloadScheduler)).toHaveBeenCalledTimes(5);

    expect((await request(app).get('/api/v1/events').query({ limit: 'bad' })).status).toBe(400);
    const events = await request(app).get('/api/v1/events').query({ source: 'directories', type: 'created', limit: 5 });
    expect(events.status).toBe(200);
    expect(events.body[0]?.source).toBe('directories');
  });

  it('manages instances and exercises connection test endpoints', async () => {
    expect((await request(app).get('/api/v1/instances/bad')).status).toBe(400);
    expect((await request(app).post('/api/v1/instances').send({ name: 'A', type: 'bad' })).status).toBe(400);
    expect((await request(app).post('/api/v1/instances').send({ name: 'A', type: 'sonarr', url: 'https://sonarr.example.com' })).status).toBe(400);
    expect(
      (
        await request(app)
          .post('/api/v1/instances')
          .send({ name: 'Bad SSL', type: 'sonarr', url: 'http://sonarr.example.com', apiKey: 'secret', skipSslVerify: true })
      ).status,
    ).toBe(400);

    const created = await request(app).post('/api/v1/instances').send({
      name: 'Sonarr',
      type: 'sonarr',
      url: 'https://sonarr.example.com///',
      apiKey: 'secret-key',
      timeout: 5000,
      remotePath: '/remote',
      localPath: '/local',
    });
    expect(created.status).toBe(201);
    expect(created.body.url).toBe('https://sonarr.example.com');
    expect(created.body.apiKey).not.toContain('secret-key');
    expect((await request(app).get(`/api/v1/instances/${created.body.id}`)).body.name).toBe('Sonarr');
    expect((await request(app).post('/api/v1/instances').send({
      name: 'Sonarr',
      type: 'sonarr',
      url: 'https://another.example.com',
      apiKey: 'duplicate-key',
    })).status).toBe(409);

    expect((await request(app).put('/api/v1/instances/999').send({ name: 'missing' })).status).toBe(404);
    expect((await request(app).put(`/api/v1/instances/${created.body.id}`).send({ type: 'wat' })).status).toBe(400);
    expect(
      (
        await request(app)
          .put(`/api/v1/instances/${created.body.id}`)
          .send({ url: 'http://updated.example.com', skipSslVerify: true })
      ).status,
    ).toBe(400);
    expect((await request(app).put(`/api/v1/instances/${created.body.id}`).send({ name: 'Sonarr 2', enabled: false })).body.name).toBe('Sonarr 2');

    expect((await request(app).post('/api/v1/instances/test').send({ type: 'sonarr', url: 'https://sonarr.example.com' })).status).toBe(400);
    expect((await request(app).post('/api/v1/instances/test').send({ type: 'lidarr', url: 'https://lidarr.example.com', apiKey: 'x' })).body).toEqual({ success: false, error: 'denied' });
    expect(
      (
        await request(app)
          .post('/api/v1/instances/test')
          .send({ type: 'sonarr', url: 'https://127.0.0.1', apiKey: 'x', skipSslVerify: true })
      ).body,
    ).toEqual({ success: true });
    expect((await request(app).get(`/api/v1/instances/${created.body.id}/test`)).body).toEqual({ success: true });
    expect((await request(app).get('/api/v1/instances/999/test')).status).toBe(404);

    expect((await request(app).delete('/api/v1/instances/nope')).status).toBe(400);
    expect((await request(app).delete(`/api/v1/instances/${created.body.id}`)).status).toBe(204);
    expect((await request(app).delete(`/api/v1/instances/${created.body.id}`)).status).toBe(404);
  });

  it('manages filters, presets, and deletion guard branches through the real app', async () => {
    const presets = await request(app).get('/api/v1/filters/presets');
    expect(presets.status).toBe(200);
    expect(presets.body[0]?.id).toBe('block_exe');

    expect((await request(app).get('/api/v1/filters/nope')).status).toBe(400);
    expect((await request(app).get('/api/v1/filters/999')).status).toBe(404);
    expect((await request(app).post('/api/v1/filters').send({ triggerSource: 'watcher' })).status).toBe(400);

    const first = await request(app).post('/api/v1/filters').send({
      name: 'Quarantine executables',
      triggerSource: 'watcher',
      ruleType: 'extension',
      rulePayload: 'exe',
      actionType: 'move',
      actionPayload: '/quarantine',
      targetPath: '/downloads',
      notifyOnMatch: true,
    });
    expect(first.status).toBe(201);
    expect((await request(app).get(`/api/v1/filters/${first.body.id}`)).body.name).toBe('Quarantine executables');

    expect(
      (
        await request(app).post('/api/v1/filters').send({
          name: 'Quarantine executables',
          triggerSource: 'watcher',
          ruleType: 'extension',
          rulePayload: 'exe',
          actionType: 'move',
          actionPayload: '/quarantine',
        })
      ).status,
    ).toBe(409);

    const second = await request(app).post('/api/v1/filters').send({
      name: 'Delete junk',
      triggerSource: 'manual',
      ruleType: 'extension',
      rulePayload: 'nfo',
      actionType: 'delete',
    });
    expect(second.status).toBe(201);

    expect((await request(app).put('/api/v1/filters/nope').send({ name: 'bad' })).status).toBe(400);
    expect((await request(app).put('/api/v1/filters/999').send({ name: 'missing' })).status).toBe(404);
    expect((await request(app).put(`/api/v1/filters/${first.body.id}`).send({ name: '' })).status).toBe(400);
    expect((await request(app).put(`/api/v1/filters/${second.body.id}`).send({ name: 'Quarantine executables' })).status).toBe(409);
    expect((await request(app).put(`/api/v1/filters/${first.body.id}`).send({ name: 'Quarantine updated' })).body.name).toBe('Quarantine updated');

    db.prepare('UPDATE filters SET is_built_in = 1 WHERE id = ?').run(second.body.id);
    expect((await request(app).delete(`/api/v1/filters/${second.body.id}`)).status).toBe(403);

    expect((await request(app).delete('/api/v1/filters/nope')).status).toBe(400);
    expect((await request(app).delete('/api/v1/filters/999')).status).toBe(404);
    expect((await request(app).delete(`/api/v1/filters/${first.body.id}`)).body.success).toBe(true);
  });
});