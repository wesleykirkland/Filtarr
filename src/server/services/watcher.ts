import chokidar, { type FSWatcher } from 'chokidar';
import type Database from 'better-sqlite3';
import { logger } from '../lib/logger.js';
import { getAllFilters } from '../../db/schemas/filters.js';
import path from 'node:path';
import { getWatcherPaths } from './filterPaths.js';
import { FilterEngine } from './filterEngine.js';

export class ChokidarManager {
  private watcher: FSWatcher | null = null;
  private db: Database.Database;
  private filterEngine: FilterEngine;

  constructor(db: Database.Database) {
    this.db = db;
    this.filterEngine = new FilterEngine(db);
  }

  public async start() {
    logger.info('Initializing File System Watcher...');

    const filters = getAllFilters(this.db);
    const pathsToWatch = getWatcherPaths(filters);

    if (pathsToWatch.length === 0) {
      logger.info('No valid enabled filter paths configured for watching.');
      this.watcher = chokidar.watch([], { persistent: true });
      return;
    }

    logger.info({ paths: pathsToWatch }, 'Starting watcher on filter target paths');

    this.watcher = chokidar.watch(pathsToWatch, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100,
      },
    });

    this.watcher
      .on('add', (filePath) => this.handleFileEvent('import', filePath))
      .on('change', (filePath) => this.handleFileEvent('change', filePath))
      .on('unlink', (filePath) => this.handleFileEvent('delete', filePath))
      .on('error', (error) => logger.error({ err: error }, 'Watcher error'));
  }

  public async reload() {
    logger.info('Reloading File System Watcher configuration...');
    await this.stop();
    await this.start();
  }

  public async stop() {
    if (this.watcher) {
      logger.info('Stopping File System Watcher...');
      await this.watcher.close();
      this.watcher = null;
    }
  }

  private handleFileEvent(event: 'import' | 'change' | 'delete', filePath: string) {
    logger.debug({ event, file: path.basename(filePath) }, `File event detected`);

    if (event === 'import' || event === 'change') {
      this.filterEngine.processFile(filePath).catch((err) => {
        logger.error({ err, filePath }, 'Filter engine failed to process file');
      });
    }
  }
}

let managerInstance: ChokidarManager | null = null;

export function initWatcher(db: Database.Database) {
  if (!managerInstance) {
    managerInstance = new ChokidarManager(db);
    managerInstance.start().catch((err) => {
      logger.error({ err }, 'Failed to start Chokidar watcher');
    });
  }
}

export function stopWatcher() {
  if (managerInstance) {
    managerInstance.stop().catch(() => {});
    managerInstance = null;
  }
}

export function reloadWatcher() {
  if (managerInstance) {
    managerInstance.reload().catch(() => {});
  }
}
