import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../../src/server/middleware/errorHandler.js';
import { isPathWithinBrowseRoot, protectedSystemRoutes, publicSystemRoutes } from '../../src/server/routes/system.js';

vi.mock('../../src/server/lib/logger.js', () => ({ logger: { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

describe('system routes', () => {
  const originalEnv = { ...process.env };
  let tempDir: string;

  beforeEach(() => {
    process.env = { ...originalEnv };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filtarr-browse-'));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('serves health with env version override and package fallback', async () => {
    const app = express();
    app.use(publicSystemRoutes);

    process.env['FILTARR_VERSION'] = ' 9.9.9 ';
    const envRes = await request(app).get('/health');
    expect(envRes.body).toEqual({ status: 'ok', version: '9.9.9' });

    delete process.env['FILTARR_VERSION'];
    const pkgRes = await request(app).get('/health');
    expect(pkgRes.body.status).toBe('ok');
    expect(pkgRes.body.version).toBe('0.1.0');
  });

  it('browses directories and handles common failures', async () => {
    fs.mkdirSync(path.join(tempDir, 'b-dir'));
    fs.mkdirSync(path.join(tempDir, 'a-dir'));
    fs.mkdirSync(path.join(tempDir, '.hidden'));
    fs.writeFileSync(path.join(tempDir, 'file.txt'), 'hello');

    // Set browse root to the temp dir so sanitizeBrowsePath allows access
    const realTempDir = fs.realpathSync(tempDir);
    process.env['FILTARR_BROWSE_ROOT'] = realTempDir;

    const app = express();
    app.use(protectedSystemRoutes);
    app.use(errorHandler);

    const success = await request(app).get('/browse').query({ path: realTempDir });
    expect(success.status).toBe(200);
    expect(success.body.entries.map((entry: { name: string }) => entry.name)).toEqual(['a-dir', 'b-dir']);

    // Non-existent paths fail realpathSync in sanitizeBrowsePath → 403
    expect((await request(app).get('/browse').query({ path: path.join(realTempDir, 'missing') })).status).toBe(403);
    expect((await request(app).get('/browse').query({ path: path.join(realTempDir, 'file.txt') })).status).toBe(400);

    vi.spyOn(fs, 'readdirSync').mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const failure = await request(app).get('/browse').query({ path: realTempDir });
    expect(failure.status).toBe(500);
    expect(failure.body.error.message).toBe('Internal Server Error');
    expect(JSON.stringify(failure.body)).not.toContain('boom');
  });

  it('allows browsing below the default "/" root', async () => {
    delete process.env['FILTARR_BROWSE_ROOT'];
    const realTempDir = fs.realpathSync(tempDir);
    const app = express();
    app.use(protectedSystemRoutes);

    const res = await request(app).get('/browse').query({ path: realTempDir });
    expect(res.status).toBe(200);
    expect(res.body.current).toBe(realTempDir);
  });

  it('checks whether existing and not-yet-created paths are inside the browse root', () => {
    const realTempDir = fs.realpathSync(tempDir);
    fs.mkdirSync(path.join(realTempDir, 'media'));
    process.env['FILTARR_BROWSE_ROOT'] = path.join(realTempDir, 'media');

    expect(isPathWithinBrowseRoot(path.join(realTempDir, 'media'))).toBe(true);
    expect(isPathWithinBrowseRoot(path.join(realTempDir, 'media', 'not-yet', 'created'))).toBe(true);
    expect(isPathWithinBrowseRoot(path.join(realTempDir, 'media', '..', 'escape'))).toBe(false);
    expect(isPathWithinBrowseRoot(path.join(realTempDir, 'media-sibling'))).toBe(false);

    fs.symlinkSync(realTempDir, path.join(realTempDir, 'media', 'link-out'));
    expect(isPathWithinBrowseRoot(path.join(realTempDir, 'media', 'link-out', 'x'))).toBe(false);

    delete process.env['FILTARR_BROWSE_ROOT'];
    expect(isPathWithinBrowseRoot('/anything/at/all')).toBe(true);
  });
});