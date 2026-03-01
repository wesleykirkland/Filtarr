import chokidar, { type FSWatcher } from 'chokidar';
import type Database from 'better-sqlite3';
import { logger } from '../lib/logger.js';
import { getAllDirectories } from '../../db/schemas/directories.js';
import path from 'node:path';
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

    // Get enabled directories from the database
    const dirs = getAllDirectories(this.db).filter((d) => d.enabled === 1);

    if (dirs.length === 0) {
      logger.info('No active directories configured for watching.');
      this.watcher = chokidar.watch([], { persistent: true });
      return;
    }

    const pathsToWatch = dirs.map((d) => d.path);
    logger.info({ paths: pathsToWatch }, 'Starting watcher on configured directories');

    this.watcher = chokidar.watch(pathsToWatch, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100,
      },
      // Since some directories might not be recursive
      depth: dirs.every((d) => d.recursive === 1) ? undefined : 0,
      // We will refine depth handling per-path later if needed,
      // but for Arr stack download folders, depth 0 or 1 is usually enough.
      // Easiest is to let chokidar watch recursively by default and filter in events,
      // but passing array of paths means settings apply globally.
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
