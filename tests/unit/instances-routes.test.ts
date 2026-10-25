import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SonarrClient as RealSonarrClient } from '../../src/services/arr/sonarr.js';

const state = vi.hoisted(() => ({
  getAllInstances: vi.fn(),
  getInstanceById: vi.fn(),
  getInstanceConfigById: vi.fn(),
  createInstance: vi.fn(),
  updateInstance: vi.fn(),
  deleteInstance: vi.fn(),
  recordActivityEvent: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  sonarrTest: vi.fn(),
  radarrTest: vi.fn(),
  lidarrTest: vi.fn(),
  close: vi.fn(),
  useRealSonarr: { value: false },
}));

vi.mock('../../src/db/schemas/instances.js', () => ({
  getAllInstances: state.getAllInstances,
  getInstanceById: state.getInstanceById,
  getInstanceConfigById: state.getInstanceConfigById,
  createInstance: state.createInstance,
  updateInstance: state.updateInstance,
  deleteInstance: state.deleteInstance,
}));
vi.mock('../../src/server/lib/activity.js', () => ({ recordActivityEvent: state.recordActivityEvent }));
vi.mock('../../src/server/lib/logger.js', () => ({ logger: state.logger }));
vi.mock('../../src/services/arr/sonarr.js', async () => {
  const actual = await vi.importActual<{ SonarrClient: typeof RealSonarrClient }>('../../src/services/arr/sonarr.js');
  return {
    SonarrClient: vi.fn(function SonarrClient(options: ConstructorParameters<typeof RealSonarrClient>[0]) {
      if (state.useRealSonarr.value) return new actual.SonarrClient(options);
      return { testConnection: state.sonarrTest, close: state.close };
    }),
  };
});
vi.mock('../../src/services/arr/radarr.js', () => ({
  RadarrClient: vi.fn(function RadarrClient() { return { testConnection: state.radarrTest, close: state.close }; }),
}));
vi.mock('../../src/services/arr/lidarr.js', () => ({
  LidarrClient: vi.fn(function LidarrClient() { return { testConnection: state.lidarrTest, close: state.close }; }),
}));

import { createInstancesRouter } from '../../src/server/routes/instances.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/', createInstancesRouter({} as never));
  return app;
}

describe('instances routes', () => {
  beforeEach(() => {
    Object.values(state).forEach((value) => {
      if (typeof value === 'function') value.mockReset();
    });
    Object.values(state.logger).forEach((mock) => mock.mockReset());
    state.close.mockResolvedValue(undefined);
    state.useRealSonarr.value = false;
  });

  it('validates ids and required fields across CRUD and test endpoints', async () => {
    const app = makeApp();

    expect((await request(app).get('/bad')).status).toBe(400);
    expect((await request(app).put('/bad').send({})).status).toBe(400);
    expect((await request(app).delete('/bad')).status).toBe(400);
    expect((await request(app).get('/bad/test')).status).toBe(400);

    expect((await request(app).post('/').send({ type: 'sonarr', url: 'https://sonarr.example.com', apiKey: 'x' })).body.error).toContain('name is required');
    expect((await request(app).post('/').send({ name: 'Main', type: 'readarr', url: 'https://readarr.example.com', apiKey: 'x' })).status).toBe(400);
    expect((await request(app).post('/').send({ name: 'Main', type: 'sonarr', url: 'https://sonarr.example.com' })).body.error).toContain('apiKey is required');
    expect((await request(app).post('/test').send({ type: 'bad', url: 'https://x', apiKey: 'x' })).status).toBe(400);
    expect((await request(app).post('/test').send({ type: 'sonarr', url: 'https://x' })).body.error).toContain('apiKey is required');
  });

  it('handles success and failure branches for create, update, and delete', async () => {
    const app = makeApp();
    state.createInstance.mockReturnValue({ id: 3, name: 'Main', type: 'sonarr', enabled: true, skipSslVerify: false });
    state.getInstanceConfigById.mockReturnValue({ id: 3, name: 'Main', type: 'sonarr', url: 'https://sonarr.example.com', apiKey: 'secret', skipSslVerify: false });
    state.updateInstance.mockReturnValue({ id: 3, name: 'Renamed', type: 'radarr', enabled: false, skipSslVerify: true });
    state.getInstanceById.mockReturnValueOnce({ id: 3, name: 'Renamed', type: 'radarr', enabled: false });
    state.deleteInstance.mockReturnValueOnce(true).mockReturnValueOnce(false);

    expect((await request(app).post('/').send({ name: 'Main', type: 'sonarr', url: 'https://sonarr.example.com///', apiKey: 'secret' })).status).toBe(201);
    expect(state.createInstance).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ url: 'https://sonarr.example.com///' }));

    const updated = await request(app).put('/3').send({ type: 'radarr', url: 'https://radarr.example.com', enabled: false, skipSslVerify: true });
    expect(updated.status).toBe(200);
    expect(state.updateInstance).toHaveBeenCalledWith(expect.anything(), 3, expect.objectContaining({ type: 'radarr', enabled: false, skipSslVerify: true }));

    expect((await request(app).delete('/3')).status).toBe(204);
    expect((await request(app).delete('/3')).status).toBe(404);

    state.createInstance.mockImplementationOnce(() => {
      const err = Object.assign(new Error('SQLITE_CONSTRAINT_UNIQUE'), { code: 'SQLITE_CONSTRAINT_UNIQUE' });
      throw err;
    });
    expect((await request(app).post('/').send({ name: 'Main', type: 'sonarr', url: 'https://sonarr.example.com', apiKey: 'secret' })).status).toBe(409);

    state.getInstanceConfigById.mockReturnValueOnce(null).mockReturnValueOnce({ id: 3, name: 'Main', type: 'sonarr', url: 'http://plain.example.com', apiKey: 'secret', skipSslVerify: false });
    expect((await request(app).put('/9').send({})).status).toBe(404);
    expect((await request(app).put('/3').send({ skipSslVerify: true })).status).toBe(400);
  });

  it('lists and fetches instances while surfacing internal failures', async () => {
    const app = makeApp();
    state.getAllInstances.mockReturnValueOnce([{ id: 1, name: 'Main' }]).mockImplementationOnce(() => { throw new Error('boom'); });
    state.getInstanceById.mockReturnValueOnce({ id: 1, name: 'Main' }).mockReturnValueOnce(null).mockImplementationOnce(() => { throw new Error('boom'); });

    expect((await request(app).get('/')).body).toEqual([{ id: 1, name: 'Main' }]);
    expect((await request(app).get('/1')).body).toEqual({ id: 1, name: 'Main' });
    expect((await request(app).get('/99')).status).toBe(404);
    expect((await request(app).get('/')).status).toBe(500);
    expect((await request(app).get('/1')).status).toBe(500);
  });

  it('tests unsaved and saved connections for each Arr client and reports failures', async () => {
    const app = makeApp();
    state.sonarrTest.mockResolvedValue({ success: true });
    state.radarrTest.mockResolvedValue({ success: false, error: 'denied' });
    state.lidarrTest.mockImplementationOnce(async () => { throw new Error('network'); });
    state.getInstanceConfigById.mockReturnValueOnce({ id: 7, name: 'Saved', type: 'sonarr', url: 'https://saved.example.com', apiKey: 'secret', timeout: 1000, skipSslVerify: false }).mockReturnValueOnce(null).mockReturnValueOnce({ id: 7, name: 'Saved', type: 'sonarr', url: 'https://saved.example.com', apiKey: 'secret', timeout: 1000, skipSslVerify: false });

    expect((await request(app).post('/test').send({ type: 'sonarr', url: 'https://sonarr.example.com', apiKey: 'x' })).body).toEqual({ success: true });
    expect((await request(app).post('/test').send({ type: 'radarr', url: 'https://radarr.example.com', apiKey: 'x' })).body).toEqual({ success: false, error: 'denied' });
    const thrown = await request(app).post('/test').send({ type: 'lidarr', url: 'https://lidarr.example.com', apiKey: 'x' });
    expect(thrown.status).toBe(500);
    expect(thrown.body).toEqual({ success: false, error: 'Connection test failed' });
    expect(state.close).toHaveBeenCalledTimes(3);

    state.sonarrTest.mockReset();
    state.sonarrTest.mockResolvedValueOnce({ success: true }).mockImplementationOnce(async () => { throw new Error('offline'); });
    expect((await request(app).get('/7/test')).body).toEqual({ success: true });
    expect((await request(app).get('/8/test')).status).toBe(404);
    expect((await request(app).get('/7/test')).body).toEqual({ success: false, error: 'offline' });
  });

  it('falls back to the stored api key only when testing the saved instance URL', async () => {
    const app = makeApp();
    const { SonarrClient } = await import('../../src/services/arr/sonarr.js');
    const saved = { id: 7, name: 'Saved', type: 'sonarr', url: 'https://Saved.Example.com/sonarr/', apiKey: 'stored-secret', skipSslVerify: false };
    state.sonarrTest.mockResolvedValue({ success: true });
    state.getInstanceConfigById.mockImplementation((_db: unknown, id: number) => (id === 7 ? saved : null));

    // Same URL modulo host case and trailing slashes: the stored key is reused.
    const ok = await request(app).post('/test').send({ type: 'sonarr', url: 'https://saved.example.com/sonarr//', apiKey: '', instanceId: 7 });
    expect(ok.body).toEqual({ success: true });
    expect(SonarrClient).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: 'stored-secret' }));
    expect(state.getInstanceConfigById).toHaveBeenCalledWith(expect.anything(), 7);

    vi.mocked(SonarrClient).mockClear();
    for (const url of ['https://edited.example.com', 'https://saved.example.com/other', 'http://saved.example.com/sonarr', 'https://saved.example.com:8443/sonarr']) {
      const res = await request(app).post('/test').send({ type: 'sonarr', url, instanceId: 7 });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('apiKey is required');
    }
    expect(SonarrClient).not.toHaveBeenCalled();

    expect((await request(app).post('/test').send({ type: 'sonarr', url: 'https://x.example.com', instanceId: 99 })).status).toBe(404);
    expect((await request(app).post('/test').send({ type: 'sonarr', url: 'https://x.example.com', instanceId: 'abc' })).status).toBe(400);
  });

  it('never sends a stored api key to a caller-supplied URL', async () => {
    const app = makeApp();
    state.useRealSonarr.value = true;
    state.getInstanceConfigById.mockReturnValue({ id: 7, name: 'Saved', type: 'sonarr', url: 'https://saved.example.com', apiKey: 'stored-secret', skipSslVerify: false });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ appName: 'Sonarr', version: '4' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const res = await request(app).post('/test').send({ type: 'sonarr', url: 'https://attacker.example.com', instanceId: 7 });
      expect(res.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('stored-secret');

      // Sanity check: the saved URL does use the stored key.
      const same = await request(app).post('/test').send({ type: 'sonarr', url: 'https://saved.example.com/', instanceId: 7 });
      expect(same.body).toMatchObject({ success: true, appName: 'Sonarr' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe('https://saved.example.com/api/v3/system/status');
      expect(fetchMock.mock.calls[0][1].headers['X-Api-Key']).toBe('stored-secret');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns only a generic error category from the unsaved test endpoint', async () => {
    const app = makeApp();
    state.useRealSonarr.value = true;
    const fetchMock = vi.fn().mockResolvedValue(new Response('SSH-2.0-OpenSSH_9.6 internal banner', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const res = await request(app).post('/test').send({ type: 'sonarr', url: 'http://10.0.0.5:22', apiKey: 'k' });
      expect(res.body).toMatchObject({ success: false, errorCode: 'unexpected_response' });
      expect(JSON.stringify(res.body)).not.toContain('SSH');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects create and update bodies with invalid field types', async () => {
    const app = makeApp();
    state.getInstanceConfigById.mockReturnValue({ id: 3, name: 'Main', type: 'sonarr', url: 'https://sonarr.example.com', apiKey: 'secret', skipSslVerify: false });
    const valid = { name: 'Main', type: 'sonarr', url: 'https://sonarr.example.com', apiKey: 'secret' };

    const badCreates = [
      { ...valid, enabled: 'false' },
      { ...valid, timeout: 'abc' },
      { ...valid, timeout: 500 },
      { ...valid, timeout: 300001 },
      { ...valid, timeout: 1500.5 },
      { ...valid, skipSslVerify: 'true' },
      { ...valid, name: { $ne: '' } },
      { ...valid, url: ['https://a.example.com'] },
      { ...valid, remotePath: 42 },
      { ...valid, name: '' },
    ];
    for (const body of badCreates) {
      const res = await request(app).post('/').send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(state.createInstance).not.toHaveBeenCalled();

    const badUpdates = [
      { enabled: 'false' },
      { timeout: 'abc' },
      { type: 'readarr' },
      { apiKey: 123 },
      { localPath: {} },
      { name: '' },
    ];
    for (const body of badUpdates) {
      const res = await request(app).put('/3').send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(state.updateInstance).not.toHaveBeenCalled();

    state.createInstance.mockReturnValue({ id: 3, name: 'Main', type: 'sonarr', enabled: false, skipSslVerify: false });
    const created = await request(app).post('/').send({ ...valid, timeout: 5000, enabled: false, remotePath: null, localPath: '/data', extra: 'ignored' });
    expect(created.status).toBe(201);
    expect(state.createInstance).toHaveBeenCalledWith(expect.anything(), expect.not.objectContaining({ extra: expect.anything() }));
    expect(state.createInstance).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ timeout: 5000, enabled: false, localPath: '/data' }));

    state.updateInstance.mockReturnValue({ id: 3, name: 'Main', type: 'sonarr', enabled: true, skipSslVerify: false });
    const updated = await request(app).put('/3').send({ timeout: 2000, apiKey: '', bogus: 1 });
    expect(updated.status).toBe(200);
    expect(state.updateInstance).toHaveBeenCalledWith(expect.anything(), 3, { timeout: 2000 });
  });
});
