import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { protectedSystemRoutes, publicSystemRoutes } from '../../src/server/routes/system.js';

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
    expect(failure.body.error).toContain('boom');
  });
});