import { Router, type Request, type Response, type NextFunction } from 'express';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { getAllJobs, getJobById, createJob, updateJob, deleteJob } from '../../db/schemas/jobs.js';
import { SecurityPolicyError, assertCustomScriptsEnabled } from '../../services/security.js';
import { recordActivityEvent } from '../lib/activity.js';
import { logger } from '../lib/logger.js';
import { reloadScheduler } from '../cron/scheduler.js';

const createJobSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  schedule: z.string().min(1, 'Cron schedule is required'), // Could add a regex to validate basic cron
  type: z.enum(['custom_script', 'built_in', 'filter_run']),
  payload: z.string().optional(),
  enabled: z.boolean().optional(),
});

const updateJobSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  schedule: z.string().min(1).optional(),
  type: z.enum(['custom_script', 'built_in', 'filter_run']).optional(),
  payload: z.string().optional(),
  enabled: z.boolean().optional(),
});

export function createJobsRoutes(db: Database.Database): Router {
  const router = Router();

  // GET /api/v1/jobs
  router.get('/', (_req: Request, res: Response, next: NextFunction): void => {
    try {
      const jobs = getAllJobs(db);
      res.json(jobs);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/jobs/:id
  router.get('/:id', (req: Request, res: Response, next: NextFunction): void => {
    try {
      const id = Number.parseInt((req.params['id'] as string) || '', 10);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: 'Invalid ID' });
        return;
      }
      const job = getJobById(db, id);
      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }
      res.json(job);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/jobs
  router.post('/', (req: Request, res: Response, next: NextFunction): void => {
    try {
      const data = createJobSchema.parse(req.body);
      if (data.type === 'custom_script') {
        assertCustomScriptsEnabled('Custom script jobs');
      }
      const job = createJob(db, data);
      logger.info({ jobId: job.id, name: job.name }, 'Job created');
      recordActivityEvent(db, {
        type: 'created',
        source: 'jobs',
        message: `Created job "${job.name}"`,
        details: { jobId: job.id, schedule: job.schedule, jobType: job.type, enabled: Boolean(job.enabled) },
      });
      reloadScheduler(db);
      res.status(201).json(job);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.issues[0]?.message || 'Invalid input' });
      } else if (err instanceof SecurityPolicyError) {
        res.status(400).json({ error: err.message });
      } else if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        res.status(409).json({ error: 'A job with this name already exists' });
      } else {
        next(err);
      }
    }
  });

  // PUT /api/v1/jobs/:id
  router.put('/:id', (req: Request, res: Response, next: NextFunction): void => {
    try {
      const id = Number.parseInt((req.params['id'] as string) || '', 10);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: 'Invalid ID' });
        return;
      }
      const current = getJobById(db, id);
      if (!current) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }
      const data = updateJobSchema.parse(req.body);
      if ((data.type ?? current.type) === 'custom_script') {
        assertCustomScriptsEnabled('Custom script jobs');
      }
      const job = updateJob(db, id, data);
      logger.info({ jobId: job.id }, 'Job updated');
      recordActivityEvent(db, {
        type: 'updated',
        source: 'jobs',
        message: `Updated job "${job.name}"`,
        details: {
          jobId: job.id,
          schedule: job.schedule,
          jobType: job.type,
          enabled: Boolean(job.enabled),
          changedFields: Object.keys(data),
        },
      });
      reloadScheduler(db);
      res.json(job);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.issues[0]?.message || 'Invalid input' });
      } else if (err instanceof SecurityPolicyError) {
        res.status(400).json({ error: err.message });
      } else if (err instanceof Error && err.message.includes('not found')) {
        res.status(404).json({ error: err.message });
      } else if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        res.status(409).json({ error: 'A job with this name already exists' });
      } else {
        next(err);
      }
    }
  });

  // DELETE /api/v1/jobs/:id
  router.delete('/:id', (req: Request, res: Response, next: NextFunction): void => {
    try {
      const id = Number.parseInt((req.params['id'] as string) || '', 10);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: 'Invalid ID' });
        return;
      }
      const current = getJobById(db, id);
      const success = deleteJob(db, id);
      if (!success) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }
      logger.info({ jobId: id }, 'Job deleted');
      const displayName = current?.name ?? `#${id}`;
      recordActivityEvent(db, {
        type: 'deleted',
        source: 'jobs',
        message: `Deleted job "${displayName}"`,
        details: current
          ? { jobId: current.id, schedule: current.schedule, jobType: current.type }
          : { jobId: id },
      });
      reloadScheduler(db);
      res.json({ success: true, message: 'Job deleted successfully' });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
