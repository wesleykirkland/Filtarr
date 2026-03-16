import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { resetConfigCache } from '../../src/config/index.js';
import { closeDatabase, openDatabase } from '../../src/db/index.js';
import { createApp } from '../../src/server/app.js';

describe('Security-sensitive route protection', () => {
  let app: ReturnType<typeof createApp>;
  let db: ReturnType<typeof openDatabase>;
  let tempDir: string;

  beforeEach(() => {
    resetConfigCache();

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filtarr-security-'));
    process.env['FILTARR_DATA_DIR'] = tempDir;
    process.env['NODE_ENV'] = 'test';

    db = openDatabase(tempDir);
    app = createApp(db);

    db.prepare(
      `INSERT OR REPLACE INTO settings (key, value, updated_at)
       VALUES ('auth_mode', 'forms', datetime('now'))`,
    ).run();
    db.prepare(
      `INSERT OR REPLACE INTO settings (key, value, updated_at)
       VALUES ('setup_complete', 'true', datetime('now'))`,
    ).run();
  });

  afterEach(() => {
    closeDatabase(db);
    resetConfigCache();
    delete process.env['FILTARR_DATA_DIR'];
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('rejects unauthenticated API key listing', async () => {
    const res = await request(app).get('/api/v1/auth/api-keys');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Authentication required' });
  });

  it('rejects unauthenticated API key creation', async () => {
    const res = await request(app).post('/api/v1/auth/api-keys').send({ name: 'Unauthorized' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Authentication required' });

    const result = db.prepare<[], { count: number }>('SELECT COUNT(*) as count FROM api_keys').get();
    expect(result?.count).toBe(0);
  });

  it('rejects unauthenticated API key rotation', async () => {
    const res = await request(app).post('/api/v1/auth/api-keys/rotate').send({ keyId: 1 });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Authentication required' });
  });

  it('rejects unauthenticated filesystem browsing', async () => {
    const res = await request(app).get('/api/v1/browse').query({ path: '/' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Authentication required' });
  });

  it('keeps the health endpoint public', async () => {
    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
  });
});