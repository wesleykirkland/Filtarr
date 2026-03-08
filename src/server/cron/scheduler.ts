import cron from 'node-cron';
import type Database from 'better-sqlite3';
import { logger } from '../lib/logger.js';
import { getAllJobs, updateJob } from '../../db/schemas/jobs.js';
import { runSandboxedScript } from '../services/scriptRunner.js';
import { FilterEngine } from '../services/filterEngine.js';
import fs from 'node:fs';
import path from 'node:path';
import { getFilterById } from '../../db/schemas/filters.js';

export class CronManager {
  private db: Database.Database;
  private filterEngine: FilterEngine;
  private activeJobs: Map<number, cron.ScheduledTask> = new Map();

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

  private scheduleJob(job: ReturnType<typeof getAllJobs>[0]) {
    if (!cron.validate(job.schedule)) {
      logger.error(
        { jobId: job.id, schedule: job.schedule },
        'Invalid cron schedule, skipping job',
      );
      return;
    }

    const task = cron.schedule(job.schedule, async () => {
      logger.info({ jobId: job.id, name: job.name }, 'Executing scheduled job');
      const startTime = new Date().toISOString();

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
          } else {
            logger.warn(
              { jobId: job.id, error: result.error, logs: result.logs },
              'Job script reported failure',
            );
          }
        } else if (job.type === 'filter_run' && job.payload) {
          await this.executeFilterJob(job);
        } else {
          logger.warn({ jobId: job.id, type: job.type }, 'Built-in job types not yet implemented');
        }

        // Update last run time
        updateJob(this.db, job.id, { lastRun: startTime });
      } catch (err: any) {
        logger.error({ jobId: job.id, err: err.message }, 'Scheduled job failed unexpectedly');
      }
    });

    this.activeJobs.set(job.id, task);
  }

  private async executeFilterJob(job: ReturnType<typeof getAllJobs>[0]) {
    try {
      const payload = JSON.parse(job.payload || '{}');
      const filterId = payload.filterId;
      if (!filterId) throw new Error('No filterId in job payload');

      const filter = getFilterById(this.db, filterId);
      if (!filter) throw new Error(`Filter ${filterId} not found`);

      if (!filter.target_path) {
        logger.warn({ jobId: job.id, filterId }, 'Scheduled filter run skipped: no target path');
        return;
      }

      if (!fs.existsSync(filter.target_path)) {
        logger.error(
          { jobId: job.id, filterId, path: filter.target_path },
          'Scheduled filter run failed: target path does not exist',
        );
        return;
      }

      const pendingFiles: Promise<void>[] = [];

      // Simple recursive crawl of the target path
      const crawl = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            crawl(fullPath);
          } else {
            pendingFiles.push(
              this.filterEngine.processFile(fullPath, 'cron', { filterIds: [filterId] }).catch((err) => {
                logger.error({ err, fullPath, filterId }, 'Scheduled filter failed to process file');
              }),
            );
          }
        }
      };

      crawl(filter.target_path);
      await Promise.allSettled(pendingFiles);
      logger.info({ jobId: job.id, filterId }, 'Scheduled filter crawl completed');
    } catch (err: any) {
      logger.error({ jobId: job.id, err: err.message }, 'Failed to execute filter job');
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
