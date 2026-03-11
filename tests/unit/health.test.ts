import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { resetConfigCache } from '../../src/config/index.js';
import { closeDatabase, openDatabase } from '../../src/db/index.js';
import { createApp } from '../../src/server/app.js';

describe('GET /api/v1/health', () => {
  let app: ReturnType<typeof createApp>;
  let db: ReturnType<typeof openDatabase>;
  let tempDir: string;

  beforeEach(() => {
    resetConfigCache();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filtarr-health-'));
    process.env['FILTARR_DATA_DIR'] = tempDir;
    process.env['NODE_ENV'] = 'test';
    db = openDatabase(tempDir);
    app = createApp(db);
  });

  afterEach(() => {
    closeDatabase(db);
    resetConfigCache();
    delete process.env['FILTARR_DATA_DIR'];
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body).toHaveProperty('version', '0.1.0');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  });
});
