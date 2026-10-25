import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  createDirectory: vi.fn(),
  updateDirectory: vi.fn(),
}));

vi.mock('../../src/db/schemas/directories.js', () => ({
  getAllDirectories: vi.fn(),
  getDirectoryById: vi.fn(),
  createDirectory: state.createDirectory,
  updateDirectory: state.updateDirectory,
  deleteDirectory: vi.fn(),
}));
vi.mock('../../src/server/lib/activity.js', () => ({ recordActivityEvent: vi.fn() }));
vi.mock('../../src/server/lib/logger.js', () => ({ logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../src/server/services/watcher.js', () => ({ reloadWatcher: vi.fn() }));

import { createDirectoriesRoutes } from '../../src/server/routes/directories.js';

describe('directories routes path validation', () => {
  const originalEnv = { ...process.env };
  let root: string;

  function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/', createDirectoriesRoutes({} as never));
    return app;
  }

  beforeEach(() => {
    process.env = { ...originalEnv };
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'filtarr-dirs-')));
    state.createDirectory
      .mockReset()
      .mockImplementation((_db: unknown, data: Record<string, unknown>) => ({ id: 1, recursive: true, enabled: true, ...data }));
    state.updateDirectory
      .mockReset()
      .mockImplementation((_db: unknown, id: number, data: Record<string, unknown>) => ({ id, recursive: true, enabled: true, path: '/x', ...data }));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('rejects relative paths and normalizes absolute ones', async () => {
    delete process.env['FILTARR_BROWSE_ROOT'];
    const app = makeApp();

    expect((await request(app).post('/').send({ path: 'relative/dir' })).status).toBe(400);

    const created = await request(app).post('/').send({ path: '/media/movies/../tv/' });
    expect(created.status).toBe(201);
    expect(state.createDirectory).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ path: '/media/tv' }));
  });

  it('rejects create and update paths outside FILTARR_BROWSE_ROOT', async () => {
    process.env['FILTARR_BROWSE_ROOT'] = path.join(root, 'media');
    fs.mkdirSync(path.join(root, 'media'));
    const app = makeApp();

    const outside = await request(app).post('/').send({ path: path.join(root, 'media', '..', 'etc') });
    expect(outside.status).toBe(400);
    expect(outside.body.error).toContain('browse root');
    expect(state.createDirectory).not.toHaveBeenCalled();

    expect((await request(app).post('/').send({ path: path.join(root, 'media', 'movies') })).status).toBe(201);

    expect((await request(app).put('/1').send({ path: '/etc' })).status).toBe(400);
    expect(state.updateDirectory).not.toHaveBeenCalled();
    expect((await request(app).put('/1').send({ path: path.join(root, 'media', 'tv') })).status).toBe(200);
    expect((await request(app).put('/1').send({ enabled: false })).status).toBe(200);
  });
});
