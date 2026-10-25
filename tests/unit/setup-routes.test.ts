import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, openDatabase } from '../../src/db/index.js';
import { errorHandler } from '../../src/server/middleware/errorHandler.js';
import { createSetupRoutes } from '../../src/server/routes/setup.js';

describe('setup routes', () => {
  let db: ReturnType<typeof openDatabase>;
  let tempDir: string;

  function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/', createSetupRoutes(db));
    app.use(errorHandler);
    return app;
  }

  function count(table: string): number {
    return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filtarr-setup-'));
    db = openDatabase(tempDir);
  });

  afterEach(() => {
    closeDatabase(db);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('rolls back the admin user and setup flag when a later write fails, so setup can be retried', async () => {
    const app = makeApp();
    db.exec(`
      CREATE TRIGGER fail_api_key_insert BEFORE INSERT ON api_keys
      BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;
    `);

    const failed = await request(app)
      .post('/complete')
      .send({ authMode: 'forms', username: 'admin', password: 'password123' });
    expect(failed.status).toBe(500);
    expect(count('users')).toBe(0);
    expect((await request(app).get('/status')).body).toEqual({ needsSetup: true });

    db.exec('DROP TRIGGER fail_api_key_insert');

    const retried = await request(app)
      .post('/complete')
      .send({ authMode: 'forms', username: 'admin', password: 'password123' });
    expect(retried.status).toBe(201);
    expect(typeof retried.body.apiKey).toBe('string');
    expect(count('users')).toBe(1);
    expect(count('api_keys')).toBe(1);
    expect((await request(app).get('/status')).body).toEqual({ needsSetup: false });

    const again = await request(app).post('/complete').send({ authMode: 'none' });
    expect(again.status).toBe(403);
  });
});
