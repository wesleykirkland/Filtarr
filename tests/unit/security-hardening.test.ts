import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { resetConfigCache } from '../../src/config/index.js';
import { closeDatabase, openDatabase } from '../../src/db/index.js';
import { getOrCreateSessionSecret } from '../../src/server/middleware/auth.js';
import { createApp } from '../../src/server/app.js';
import { runSandboxedScript } from '../../src/server/services/scriptRunner.js';

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

  it('allows internal Arr URLs while still rejecting unsafe outbound webhook targets', async () => {
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

    const filterRes = await request(app).post('/api/v1/filters').send({
      name: 'Unsafe Webhook',
      triggerSource: 'watcher',
      ruleType: 'extension',
      rulePayload: 'mkv',
      actionType: 'notify',
      notifyOnMatch: true,
      notifyWebhookUrl: 'file:///etc/passwd',
    });
    expect(filterRes.status).toBe(400);
    expect(filterRes.body.error).toContain('https protocol');

    const settingsRes = await request(app)
      .put('/api/v1/settings/notifications')
      .send({ slackWebhookUrl: 'https://localhost/hooks/test' });
    expect(settingsRes.status).toBe(400);
    expect(settingsRes.body.error).toContain('private network');
  });

  it('gates custom script filters and jobs behind an explicit env flag', async () => {
    const filterRes = await request(app).post('/api/v1/filters').send({
      name: 'Script Rule',
      triggerSource: 'watcher',
      ruleType: 'script',
      rulePayload: 'return true;',
      actionType: 'notify',
    });
    expect(filterRes.status).toBe(400);
    expect(filterRes.body.error).toContain('FILTARR_ENABLE_CUSTOM_SCRIPTS=true');

    const jobRes = await request(app).post('/api/v1/jobs').send({
      name: 'Script Job',
      schedule: '* * * * *',
      type: 'custom_script',
      payload: 'return true;',
    });
    expect(jobRes.status).toBe(400);
    expect(jobRes.body.error).toContain('FILTARR_ENABLE_CUSTOM_SCRIPTS=true');
  });

  it('disables runtime script execution until explicitly enabled', async () => {
    const disabled = await runSandboxedScript('return 42;', {});
    expect(disabled.success).toBe(false);
    expect(disabled.error).toContain('FILTARR_ENABLE_CUSTOM_SCRIPTS=true');

    process.env['FILTARR_ENABLE_CUSTOM_SCRIPTS'] = 'true';
    const enabled = await runSandboxedScript('return 42;', {});
    expect(enabled.success).toBe(true);
    expect(enabled.output).toBe(42);
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