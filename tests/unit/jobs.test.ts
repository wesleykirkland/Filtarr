import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/app.js';

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
});