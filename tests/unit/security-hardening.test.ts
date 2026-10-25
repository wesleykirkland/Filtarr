import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { resetConfigCache } from '../../src/config/index.js';
import { closeDatabase, openDatabase } from '../../src/db/index.js';
import { getOrCreateSessionSecret } from '../../src/server/middleware/auth.js';
import { createApp } from '../../src/server/app.js';

describe('Security hardening', () => {
  let app: ReturnType<typeof createApp>;
  let db: ReturnType<typeof openDatabase>;
  let tempDir: string;

  beforeEach(() => {
    resetConfigCache();

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filtarr-hardening-'));
    process.env['FILTARR_DATA_DIR'] = tempDir;
    process.env['NODE_ENV'] = 'test';
    delete process.env['FILTARR_ENABLE_CUSTOM_SCRIPTS'];

    db = openDatabase(tempDir);
    app = createApp(db);
  });

  afterEach(() => {
    closeDatabase(db);
    resetConfigCache();
    delete process.env['FILTARR_DATA_DIR'];
    delete process.env['FILTARR_ENABLE_CUSTOM_SCRIPTS'];
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('allows internal Arr URLs with skipSslVerify for local instances', async () => {
    const instanceRes = await request(app).post('/api/v1/instances').send({
      name: 'Local Sonarr',
      type: 'sonarr',
      url: 'https://127.0.0.1:8989',
      apiKey: 'secret',
      skipSslVerify: true,
    });
    expect(instanceRes.status).toBe(201);
    expect(instanceRes.body.url).toBe('https://127.0.0.1:8989');
    expect(instanceRes.body.skipSslVerify).toBe(true);
  });

  it('gates custom script jobs behind an explicit env flag', async () => {
    const jobRes = await request(app).post('/api/v1/jobs').send({
      name: 'Script Job',
      schedule: '* * * * *',
      type: 'custom_script',
      payload: 'return true;',
    });
    expect(jobRes.status).toBe(403);
    expect(jobRes.body.error).toContain('FILTARR_ENABLE_CUSTOM_SCRIPTS=true');
  });

  it('gates script filters behind the custom script flag', async () => {
    const base = {
      triggerSource: 'manual',
      rulePayload: 'return true;',
      actionType: 'blocklist',
      scriptRuntime: 'javascript',
    };

    const ruleRes = await request(app)
      .post('/api/v1/filters')
      .send({ ...base, name: 'Script Rule', ruleType: 'script' });
    expect(ruleRes.status).toBe(403);
    expect(ruleRes.body.error).toContain('FILTARR_ENABLE_CUSTOM_SCRIPTS=true');

    const actionRes = await request(app).post('/api/v1/filters').send({
      ...base,
      name: 'Script Action',
      ruleType: 'extension',
      rulePayload: 'exe',
      actionType: 'script',
      actionPayload: 'echo hi',
    });
    expect(actionRes.status).toBe(403);

    const plainRes = await request(app).post('/api/v1/filters').send({
      ...base,
      name: 'Plain Filter',
      ruleType: 'extension',
      rulePayload: 'exe',
    });
    expect(plainRes.status).toBe(201);

    const updateRes = await request(app)
      .put(`/api/v1/filters/${plainRes.body.id}`)
      .send({ ruleType: 'script', rulePayload: 'return true;' });
    expect(updateRes.status).toBe(403);

    process.env['FILTARR_ENABLE_CUSTOM_SCRIPTS'] = 'true';
    const enabledRes = await request(app)
      .post('/api/v1/filters')
      .send({ ...base, name: 'Script Rule', ruleType: 'script' });
    expect(enabledRes.status).toBe(201);
  });

  it('persists a generated session secret to the data directory', () => {
    const config = {
      mode: 'forms' as const,
      apiKeyBcryptRounds: 12,
      rateLimitAuth: 5,
      rateLimitGeneral: 100,
      corsOrigin: 'same-origin' as const,
      forms: {
        sessionMaxAge: 86_400_000,
        cookieName: 'filtarr.sid',
      },
    };

    const first = getOrCreateSessionSecret(config);
    const second = getOrCreateSessionSecret(config);

    expect(first).toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(64);
    expect(fs.readFileSync(path.join(tempDir, '.session-secret'), 'utf-8').trim()).toBe(first);
  });
});