import cron, { type ScheduledTask } from 'node-cron';
import type Database from 'better-sqlite3';
import { logger } from '../lib/logger.js';
import { getAllJobs, updateJob } from '../../db/schemas/jobs.js';
import { recordActivityEvent } from '../lib/activity.js';
import { runSandboxedScript } from '../services/scriptRunner.js';
import { FilterEngine } from '../services/filterEngine.js';
import fs from 'node:fs';
import path from 'node:path';
import { getFilterById } from '../../db/schemas/filters.js';

/** Maximum number of files a scheduled filter run processes at once. */
export const FILTER_JOB_CONCURRENCY = 4;

type JobRow = ReturnType<typeof getAllJobs>[0];

/**
 * Recursively yields every non-hidden, non-directory entry below `dir` using async fs
 * calls so large trees do not block the event loop.
 */
async function* walkFiles(dir: string): AsyncGenerator<string> {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    // Hidden files and directories are never part of a scheduled filter run.
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(fullPath);
    } else {
      yield fullPath;
    }
  }
}

/**
 * Runs `worker` over every item of `source` with at most `limit` in flight.
 * Rejects with the first source/worker error once all in-flight work settles.
 */
export async function forEachWithConcurrency<T>(
  source: AsyncIterable<T> | Iterable<T>,
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const iterator =
    Symbol.asyncIterator in source
      ? source[Symbol.asyncIterator]()
      : (source as Iterable<T>)[Symbol.iterator]();
  let failed = false;

  const runner = async () => {
    while (!failed) {
      const next = await iterator.next();
      if (next.done) return;
      await worker(next.value);
    }
  };

  const results = await Promise.allSettled(
    Array.from({ length: Math.max(1, limit) }, () =>
      runner().catch((err: unknown) => {
        failed = true;
        throw err;
      }),
    ),
  );
  const rejection = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (rejection) throw rejection.reason;
}

export class CronManager {
  private readonly db: Database.Database;
  private readonly filterEngine: FilterEngine;
  private readonly activeJobs: Map<number, ScheduledTask> = new Map();
  /** Ids of jobs whose previous tick is still executing (survives reloads). */
  private readonly runningJobs = new Set<number>();

  constructor(db: Database.Database) {
    this.db = db;
    this.filterEngine = new FilterEngine(db);
  }

  public start() {
    logger.info('Initializing Cron Scheduler...');
    const jobs = getAllJobs(this.db).filter((j) => j.enabled === 1);

    for (const job of jobs) {
      this.scheduleJob(job);
    }

    logger.info(`Scheduled ${jobs.length} background jobs.`);
  }

  public stop() {
    logger.info('Stopping Cron Scheduler...');
    for (const task of this.activeJobs.values()) {
      task.stop();
    }
    this.activeJobs.clear();
  }

  public reload() {
    logger.info('Reloading Cron Scheduler configuration...');
    this.stop();
    this.start();
  }

  private scheduleJob(job: JobRow) {
    // Five-field expressions only; a seconds field would allow sub-minute runs.
    if (job.schedule.trim().split(/\s+/).length !== 5 || !cron.validate(job.schedule)) {
      logger.error(
        { jobId: job.id, schedule: job.schedule },
        'Invalid cron schedule, skipping job',
      );
      return;
    }

    const task = cron.schedule(job.schedule, async () => {
      if (this.runningJobs.has(job.id)) {
        logger.warn(
          { jobId: job.id, name: job.name },
          'Skipping scheduled job tick because the previous run is still in progress',
        );
        return;
      }

      this.runningJobs.add(job.id);
      try {
        await this.runJob(job);
      } finally {
        this.runningJobs.delete(job.id);
      }
    });

    this.activeJobs.set(job.id, task);
  }

  private async runJob(job: JobRow) {
    logger.info({ jobId: job.id, name: job.name }, 'Executing scheduled job');
    const startTime = new Date().toISOString();
    recordActivityEvent(this.db, {
      type: 'run',
      source: 'jobs',
      message: `Started scheduled job "${job.name}"`,
      details: { jobId: job.id, jobType: job.type, schedule: job.schedule, status: 'started' },
    });

    try {
      if (job.type === 'custom_script' && job.payload) {
        const result = await runSandboxedScript(job.payload, {
          job: { id: job.id, name: job.name },
        });
        if (result.success) {
          logger.debug(
            { jobId: job.id, output: result.output },
            'Job script completed successfully',
          );
          recordActivityEvent(this.db, {
            type: 'run',
            source: 'jobs',
            message: `Scheduled job "${job.name}" completed successfully`,
            details: { jobId: job.id, jobType: job.type, status: 'success' },
          });
        } else {
          logger.warn(
            { jobId: job.id, error: result.error, logs: result.logs },
            'Job script reported failure',
          );
          recordActivityEvent(this.db, {
            type: 'run',
            source: 'jobs',
            message: `Scheduled job "${job.name}" reported failure`,
            details: { jobId: job.id, jobType: job.type, status: 'failure', error: result.error },
          });
        }
      } else if (job.type === 'filter_run' && job.payload) {
        await this.executeFilterJob(job);
      } else {
        logger.warn({ jobId: job.id, type: job.type }, 'Built-in job types not yet implemented');
        recordActivityEvent(this.db, {
          type: 'run',
          source: 'jobs',
          message: `Scheduled job "${job.name}" was skipped`,
          details: { jobId: job.id, jobType: job.type, status: 'skipped' },
        });
      }

      // Update last run time
      updateJob(this.db, job.id, { lastRun: startTime });
    } catch (err: any) {
      logger.error({ jobId: job.id, err: err.message }, 'Scheduled job failed unexpectedly');
      recordActivityEvent(this.db, {
        type: 'run',
        source: 'jobs',
        message: `Scheduled job "${job.name}" failed`,
        details: { jobId: job.id, jobType: job.type, status: 'failure', error: err.message },
      });
    }
  }

  private async executeFilterJob(job: JobRow) {
    try {
      const payload = JSON.parse(job.payload || '{}');
      const filterId = payload.filterId;
      if (!filterId) throw new Error('No filterId in job payload');

      const filter = getFilterById(this.db, filterId);
      if (!filter) throw new Error(`Filter ${filterId} not found`);

      if (!filter.target_path) {
        logger.warn({ jobId: job.id, filterId }, 'Scheduled filter run skipped: no target path');
        recordActivityEvent(this.db, {
          type: 'run',
          source: 'jobs',
          message: `Scheduled filter job "${job.name}" skipped because no target path is configured`,
          details: { jobId: job.id, filterId, status: 'skipped' },
        });
        return;
      }

      if (!fs.existsSync(filter.target_path)) {
        logger.error(
          { jobId: job.id, filterId, path: filter.target_path },
          'Scheduled filter run failed: target path does not exist',
        );
        recordActivityEvent(this.db, {
          type: 'run',
          source: 'jobs',
          message: `Scheduled filter job "${job.name}" failed because ${filter.target_path} does not exist`,
          details: { jobId: job.id, filterId, status: 'failure', targetPath: filter.target_path },
        });
        return;
      }

      let queuedFiles = 0;
      let failedFiles = 0;
      await forEachWithConcurrency(
        walkFiles(filter.target_path),
        FILTER_JOB_CONCURRENCY,
        async (fullPath) => {
          queuedFiles += 1;
          try {
            await this.filterEngine.processFile(fullPath, 'cron', { filterIds: [filter.id] });
          } catch (err) {
            failedFiles += 1;
            logger.error({ err, fullPath }, 'Scheduled filter failed to process file');
          }
        },
      );

      if (failedFiles > 0) {
        logger.warn(
          { jobId: job.id, filterId, queuedFiles, failedFiles },
          'Scheduled filter run finished with file failures',
        );
        recordActivityEvent(this.db, {
          type: 'run',
          source: 'jobs',
          message: `Scheduled filter job "${job.name}" failed for ${failedFiles} of ${queuedFiles} files`,
          details: { jobId: job.id, filterId, status: 'failure', queuedFiles, failedFiles },
        });
        return;
      }

      logger.info({ jobId: job.id, filterId, queuedFiles }, 'Scheduled filter run completed');
      recordActivityEvent(this.db, {
        type: 'run',
        source: 'jobs',
        message: `Scheduled filter job "${job.name}" completed`,
        details: { jobId: job.id, filterId, status: 'success', queuedFiles, failedFiles },
      });
    } catch (err: any) {
      logger.error({ jobId: job.id, err: err.message }, 'Failed to execute filter job');
      recordActivityEvent(this.db, {
        type: 'run',
        source: 'jobs',
        message: `Scheduled filter job "${job.name}" failed`,
        details: { jobId: job.id, status: 'failure', error: err.message },
      });
    }
  }
}

let managerInstance: CronManager | null = null;

export function initScheduler(db: Database.Database) {
  if (!managerInstance) {
    managerInstance = new CronManager(db);
    managerInstance.start();
  }
}

export function stopScheduler() {
  if (managerInstance) {
    managerInstance.stop();
    managerInstance = null;
  }
}

export function reloadScheduler(db: Database.Database) {
  if (managerInstance) {
    managerInstance.reload();
  } else {
    initScheduler(db);
  }
}
