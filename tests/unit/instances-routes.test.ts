import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  getAllInstances: vi.fn(),
  getInstanceById: vi.fn(),
  getInstanceConfigById: vi.fn(),
  createInstance: vi.fn(),
  updateInstance: vi.fn(),
  deleteInstance: vi.fn(),
  recordActivityEvent: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn() },
  sonarrTest: vi.fn(),
  radarrTest: vi.fn(),
  lidarrTest: vi.fn(),
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
vi.mock('../../src/services/arr/sonarr.js', () => ({
  SonarrClient: vi.fn(function SonarrClient() { return { testConnection: state.sonarrTest }; }),
}));
vi.mock('../../src/services/arr/radarr.js', () => ({
  RadarrClient: vi.fn(function RadarrClient() { return { testConnection: state.radarrTest }; }),
}));
vi.mock('../../src/services/arr/lidarr.js', () => ({
  LidarrClient: vi.fn(function LidarrClient() { return { testConnection: state.lidarrTest }; }),
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
    expect((await request(app).post('/test').send({ type: 'lidarr', url: 'https://lidarr.example.com', apiKey: 'x' })).body).toEqual({ success: false, error: 'network' });

    state.sonarrTest.mockReset();
    state.sonarrTest.mockResolvedValueOnce({ success: true }).mockImplementationOnce(async () => { throw new Error('offline'); });
    expect((await request(app).get('/7/test')).body).toEqual({ success: true });
    expect((await request(app).get('/8/test')).status).toBe(404);
    expect((await request(app).get('/7/test')).body).toEqual({ success: false, error: 'offline' });
  });
});
