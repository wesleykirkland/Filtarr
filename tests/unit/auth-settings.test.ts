import bcrypt from 'bcrypt';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDatabase } from '../../src/db/index.js';
import { createSettingsRoutes } from '../../src/server/routes/settings.js';
import { decryptStoredSecret } from '../../src/services/encryption.js';

const db = getDatabase();
const app = express();
app.use(express.json());
app.use('/api/v1/settings', createSettingsRoutes(db));

const settingKeys = [
  'auth_mode',
  'oidc_issuer_url',
  'oidc_client_id',
  'oidc_client_secret',
  'oidc_callback_url',
  'oidc_scopes',
] as const;

type Snapshot = Partial<Record<(typeof settingKeys)[number], string>>;

function readSnapshot(): Snapshot {
  const rows = db
    .prepare<[string, string, string, string, string, string], { key: string; value: string }>(
      `SELECT key, value FROM settings WHERE key IN (?, ?, ?, ?, ?, ?)`,
    )
    .all(...settingKeys);

  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

function restoreSnapshot(snapshot: Snapshot) {
  for (const key of settingKeys) {
    if (snapshot[key] === undefined) {
      db.prepare('DELETE FROM settings WHERE key = ?').run(key);
    } else {
      db.prepare(
        `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`,
      ).run(key, snapshot[key]);
    }
  }
}

describe('settings auth mode OIDC configuration', () => {
  let snapshot: Snapshot;

  beforeAll(() => {
    snapshot = readSnapshot();
  });

  afterAll(() => {
    restoreSnapshot(snapshot);
  });

  it('returns oidc settings alongside auth mode details', async () => {
    const res = await request(app).get('/api/v1/settings/auth-mode');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('authMode');
    expect(res.body).toHaveProperty('hasAdminUser');
    expect(res.body).toHaveProperty('oidc');
    expect(res.body.oidc).toHaveProperty('issuerUrl');
    expect(res.body.oidc).toHaveProperty('clientId');
    expect(res.body.oidc).toHaveProperty('clientSecret');
    expect(res.body.oidc).toHaveProperty('callbackUrl');
    expect(Array.isArray(res.body.oidc.scopes)).toBe(true);
  });

  it('rejects switching to oidc mode while no OIDC strategy is available', async () => {
    const before = readSnapshot();
    const res = await request(app)
      .put('/api/v1/settings/auth-mode')
      .send({
        authMode: 'oidc',
        oidc: {
          issuerUrl: 'https://issuer.example.com/realms/filtarr',
          clientId: 'filtarr-web',
          clientSecret: 'super-secret-value',
          callbackUrl: 'http://localhost:9898/api/v1/auth/oidc/callback',
          scopes: ['openid', 'profile', 'email'],
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/OIDC authentication is not yet available/);
    expect(readSnapshot()).toEqual(before);
  });

  it('persists oidc settings through the auth-mode endpoint', async () => {
    const res = await request(app)
      .put('/api/v1/settings/auth-mode')
      .send({
        authMode: 'none',
        oidc: {
          issuerUrl: 'https://issuer.example.com/realms/filtarr',
          clientId: 'filtarr-web',
          clientSecret: 'super-secret-value',
          callbackUrl: 'http://localhost:9898/api/v1/auth/oidc/callback',
          scopes: ['openid', 'profile', 'email', 'groups'],
        },
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, authMode: 'none' });

    const stored = readSnapshot();
    expect(stored.auth_mode).toBe('none');
    expect(stored.oidc_issuer_url).toBe('https://issuer.example.com/realms/filtarr');
    expect(stored.oidc_client_id).toBe('filtarr-web');
    expect(stored.oidc_client_secret).toMatch(/^enc:/);
    expect(decryptStoredSecret(stored.oidc_client_secret)).toBe('super-secret-value');
    expect(stored.oidc_callback_url).toBe('http://localhost:9898/api/v1/auth/oidc/callback');
    expect(stored.oidc_scopes).toBe('openid,profile,email,groups');
  });
});

describe('settings auth mode change requires the current password', () => {
  let snapshot: Snapshot;
  let userId: number;

  // Simulates an API-key-authenticated caller: a key alone must not be enough to switch modes.
  const apiKeyApp = express();
  apiKeyApp.use(express.json());
  apiKeyApp.use((req, _res, next) => {
    (req as any).apiKey = { apiKeyId: 1, apiKeyName: 'automation' };
    next();
  });
  apiKeyApp.use('/api/v1/settings', createSettingsRoutes(db));

  beforeAll(async () => {
    snapshot = readSnapshot();
    db.prepare(
      `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('auth_mode', 'forms', datetime('now'))`,
    ).run();
    const hash = await bcrypt.hash('correct-horse', 4);
    userId = Number(
      db
        .prepare(`INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)`)
        .run('pw-check-admin', hash, 'Administrator').lastInsertRowid,
    );
  });

  afterAll(() => {
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    restoreSnapshot(snapshot);
  });

  it('rejects the change when currentPassword is missing', async () => {
    const res = await request(app).put('/api/v1/settings/auth-mode').send({ authMode: 'none' });
    expect(res.status).toBe(401);
    expect(readSnapshot().auth_mode).toBe('forms');
  });

  it('rejects the change when currentPassword is wrong', async () => {
    const res = await request(app)
      .put('/api/v1/settings/auth-mode')
      .send({ authMode: 'none', currentPassword: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Current password is incorrect' });
    expect(readSnapshot().auth_mode).toBe('forms');
  });

  it('rejects API-key callers that do not supply the current password', async () => {
    const res = await request(apiKeyApp).put('/api/v1/settings/auth-mode').send({ authMode: 'basic' });
    expect(res.status).toBe(401);
    expect(readSnapshot().auth_mode).toBe('forms');
  });

  it('applies the change when currentPassword is correct', async () => {
    const res = await request(apiKeyApp)
      .put('/api/v1/settings/auth-mode')
      .send({ authMode: 'basic', currentPassword: 'correct-horse' });
    expect(res.status).toBe(200);
    expect(readSnapshot().auth_mode).toBe('basic');
  });
});
