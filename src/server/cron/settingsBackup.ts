import type Database from 'better-sqlite3';
import { logger } from '../lib/logger.js';
import { SettingsBackupService } from '../services/settingsBackup.js';

const ONE_MINUTE_MS = 60 * 1000;

export class SettingsBackupScheduler {
  private timeoutId: NodeJS.Timeout | null = null;
  private isStopping = false;

  constructor(
    private readonly db: Database.Database,
    private readonly backupService: SettingsBackupService = new SettingsBackupService(db),
  ) {}

  public start(): void {
    this.isStopping = false;
    logger.info('Starting settings backup scheduler');
    this.scheduleNextRun();
  }

  public stop(): void {
    this.isStopping = true;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    logger.info('Stopped settings backup scheduler');
  }

  private scheduleNextRun(): void {
    if (this.isStopping) return;

    const state = this.backupService.getState();
    if (!state.enabled) {
      logger.info('Settings backup scheduler is disabled');
      return;
    }

    const nextBackupAt = state.nextBackupAt ? Date.parse(state.nextBackupAt) : Date.now() + ONE_MINUTE_MS;
    const delay = Math.max(ONE_MINUTE_MS, nextBackupAt - Date.now());

    this.timeoutId = setTimeout(async () => {
      try {
        if (this.backupService.isBackupDue()) {
          this.backupService.createBackup('scheduled');
        }
      } catch (error) {
        logger.error({ err: error }, 'Scheduled settings backup failed');
      } finally {
        this.scheduleNextRun();
      }
    }, delay);
  }
}

let schedulerInstance: SettingsBackupScheduler | null = null;

export function startSettingsBackupScheduler(db: Database.Database): void {
  if (!schedulerInstance) {
    schedulerInstance = new SettingsBackupScheduler(db);
    schedulerInstance.start();
  }
}

export function stopSettingsBackupScheduler(): void {
  if (schedulerInstance) {
    schedulerInstance.stop();
    schedulerInstance = null;
  }
}