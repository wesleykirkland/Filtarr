import chokidar, { type ChokidarOptions, type FSWatcher } from 'chokidar';
import type Database from 'better-sqlite3';
import { logger } from '../lib/logger.js';
import { getConfig } from '../../config/index.js';
import { getAllFilters } from '../../db/schemas/filters.js';
import path from 'node:path';
import { getWatcherPaths } from './filterPaths.js';
import { FilterEngine } from './filterEngine.js';

/**
 * File name suffixes written by download clients while a transfer is still in
 * progress. Events for these files are ignored; the final rename produces an
 * event for the completed file instead.
 */
const IN_PROGRESS_SUFFIXES = ['.part', '.!qb', '.crdownload'];

/**
 * Equivalent of the globs `**\/*.part`, `**\/*.!qB`, `**\/*.crdownload` and
 * `**\/.*`. Chokidar >= 4 no longer supports glob matchers, so this is
 * expressed as a predicate over the path's basename.
 */
export function isIgnoredWatcherPath(filePath: string): boolean {
  const name = path.basename(filePath);
  if (name.startsWith('.')) return true;
  const lower = name.toLowerCase();
  return IN_PROGRESS_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

export class ChokidarManager {
  private watcher: FSWatcher | null = null;
  private readonly db: Database.Database;
  private readonly filterEngine: FilterEngine;
  /**
   * Every start/stop/reload is chained onto this promise so lifecycle
   * operations never interleave (e.g. two quick reloads cannot leave two live
   * watchers behind). It never rejects; failures are surfaced to the caller
   * through the promise returned by the individual operation.
   */
  private lifecycle: Promise<void> = Promise.resolve();
  /** A queued-but-not-yet-running reload; further reload requests coalesce into it. */
  private pendingReload: Promise<void> | null = null;

  constructor(db: Database.Database) {
    this.db = db;
    this.filterEngine = new FilterEngine(db);
  }

  public start(): Promise<void> {
    return this.enqueue(() => this.startWatcher());
  }

  public reload(): Promise<void> {
    if (this.pendingReload) {
      logger.debug('Watcher reload already pending; coalescing request');
      return this.pendingReload;
    }

    const reload = this.enqueue(async () => {
      // Clear before running so a request arriving mid-reload queues a fresh
      // reload that observes the latest configuration.
      this.pendingReload = null;
      logger.info('Reloading File System Watcher configuration...');
      await this.stopWatcher();
      await this.startWatcher();
    });
    this.pendingReload = reload;
    return reload;
  }

  public stop(): Promise<void> {
    return this.enqueue(() => this.stopWatcher());
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.lifecycle.then(operation);
    // Keep the chain alive after a failure; the caller handles `result`.
    this.lifecycle = result.catch(() => undefined);
    return result;
  }

  private async startWatcher() {
    // Defensive: never leave a previous watcher running.
    await this.stopWatcher();

    logger.info('Initializing File System Watcher...');

    const filters = getAllFilters(this.db);
    const pathsToWatch = getWatcherPaths(filters);

    if (pathsToWatch.length === 0) {
      logger.info('No valid enabled filter paths configured for watching.');
      this.watcher = chokidar.watch([], { persistent: true });
      return;
    }

    const usePolling = getConfig().watcherPolling;
    logger.info({ paths: pathsToWatch, usePolling }, 'Starting watcher on filter target paths');

    const options: ChokidarOptions = {
      persistent: true,
      ignoreInitial: true,
      ignored: (filePath: string) => isIgnoredWatcherPath(filePath),
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100,
      },
    };
    if (usePolling) {
      options.usePolling = true;
    }

    this.watcher = chokidar.watch(pathsToWatch, options);

    this.watcher
      .on('add', (filePath) => this.handleFileEvent('import', filePath))
      .on('change', (filePath) => this.handleFileEvent('change', filePath))
      .on('unlink', (filePath) => this.handleFileEvent('delete', filePath))
      .on('error', (error) => logger.error({ err: error }, 'Watcher error'));
  }

  private async stopWatcher() {
    if (this.watcher) {
      const watcher = this.watcher;
      this.watcher = null;
      logger.info('Stopping File System Watcher...');
      await watcher.close();
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

export function initWatcher(db: Database.Database): Promise<void> {
  if (managerInstance) return Promise.resolve();

  managerInstance = new ChokidarManager(db);
  return managerInstance.start().catch((err) => {
    logger.error({ err }, 'Failed to start Chokidar watcher');
  });
}

export function stopWatcher(): Promise<void> {
  if (!managerInstance) return Promise.resolve();

  const manager = managerInstance;
  managerInstance = null;
  return manager.stop().catch((err) => {
    logger.error({ err }, 'Failed to stop Chokidar watcher');
  });
}

export function reloadWatcher(): Promise<void> {
  if (!managerInstance) return Promise.resolve();

  return managerInstance.reload().catch((err) => {
    logger.error({ err }, 'Failed to reload Chokidar watcher');
  });
}
