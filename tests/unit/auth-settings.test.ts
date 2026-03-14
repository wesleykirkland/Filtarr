import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDatabase } from '../../src/db/index.js';
import { createSettingsRoutes } from '../../src/server/routes/settings.js';

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

// TODO: These tests are for OIDC features not yet implemented in this branch
describe.skip('settings auth mode OIDC configuration', () => {
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

  it('persists oidc settings through the auth-mode endpoint', async () => {
    const res = await request(app)
      .put('/api/v1/settings/auth-mode')
      .send({
        authMode: 'oidc',
        oidc: {
          issuerUrl: 'https://issuer.example.com/realms/filtarr',
          clientId: 'filtarr-web',
          clientSecret: 'super-secret-value',
          callbackUrl: 'http://localhost:9898/api/v1/auth/oidc/callback',
          scopes: ['openid', 'profile', 'email', 'groups'],
        },
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, authMode: 'oidc' });

    const stored = readSnapshot();
    expect(stored.auth_mode).toBe('oidc');
    expect(stored.oidc_issuer_url).toBe('https://issuer.example.com/realms/filtarr');
    expect(stored.oidc_client_id).toBe('filtarr-web');
    expect(stored.oidc_client_secret).toBe('super-secret-value');
    expect(stored.oidc_callback_url).toBe('http://localhost:9898/api/v1/auth/oidc/callback');
    expect(stored.oidc_scopes).toBe('openid,profile,email,groups');
  });
});
