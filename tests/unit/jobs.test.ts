import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/app.js';
import { getDatabase } from '../../src/db/index.js';
import { markSetupComplete } from '../support/setupState.js';

markSetupComplete(getDatabase());

describe('job routes', () => {
  const app = createApp();
  const createdJobIds: number[] = [];

  afterAll(async () => {
    await Promise.all(createdJobIds.map((jobId) => request(app).delete(`/api/v1/jobs/${jobId}`)));
  });

  it('accepts filter_run jobs from the scheduler UI contract', async () => {
    const res = await request(app)
      .post('/api/v1/jobs')
      .send({
        name: `Scheduler Filter Run ${Date.now()}`,
        schedule: '0 * * * *',
        type: 'filter_run',
        payload: JSON.stringify({ filterId: 123 }),
        enabled: true,
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('type', 'filter_run');
    expect(res.body).toHaveProperty('payload', JSON.stringify({ filterId: 123 }));

    createdJobIds.push(res.body.id);
  });

  it.each([
    ['* * * * * *', 'five fields'],
    ['*/5 * * * * *', 'five fields'],
    ['0 0 * * * * *', 'five fields'],
    ['61 * * * *', 'not a valid cron expression'],
    ['   ', 'Cron schedule is required'],
  ])('rejects schedule %j', async (schedule, message) => {
    const res = await request(app)
      .post('/api/v1/jobs')
      .send({ name: `Bad Schedule ${Date.now()}`, schedule, type: 'built_in' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain(message);
  });

  it('rejects per-second schedules on update', async () => {
    const created = await request(app)
      .post('/api/v1/jobs')
      .send({ name: `Update Schedule ${Date.now()}`, schedule: '*/5 * * * *', type: 'built_in', enabled: false });
    expect(created.status).toBe(201);
    createdJobIds.push(created.body.id);

    const res = await request(app).put(`/api/v1/jobs/${created.body.id}`).send({ schedule: '* * * * * *' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('per-second');
  });
});
