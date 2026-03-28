import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { logger } from '../lib/logger.js';
import { getAllFilters, type FilterRow } from '../../db/schemas/filters.js';
import { getInstanceConfigById } from '../../db/schemas/instances.js';
import { createArrClient } from '../routes/instances.js';
import { isPathWithinTarget, normalizeFilterTargetPath } from './filterPaths.js';
import { NotificationService } from './NotificationService.js';
import { normalizeScriptRuntime, runConfiguredScript } from './scriptRunner.js';

function didScriptRuleMatch(output: unknown, runtime: 'javascript' | 'shell'): boolean {
  if (runtime === 'shell') {
    const normalized = (typeof output === 'string' ? output : '').trim().toLowerCase();
    return ['1', 'true', 'yes', 'match'].includes(normalized);
  }

  return Boolean(output);
}

export interface FileEvent {
  path: string;
  name: string;
  size: number;
  extension: string;
}

export type FilterEventType = 'watcher' | 'cron' | 'manual';

interface ProcessFileOptions {
  filterIds?: number[];
}

export class FilterEngine {
  private readonly db: Database.Database;
  private readonly notificationService: NotificationService;

  constructor(db: Database.Database) {
    this.db = db;
    this.notificationService = new NotificationService(db);
  }

  /**
   * Process a file through all applicable filters.
   */
  public async processFile(
    filePath: string,
    eventType: FilterEventType = 'watcher',
    options: ProcessFileOptions = {},
  ) {
    const fileName = path.basename(filePath);
    const extension = path.extname(filePath).toLowerCase().replace('.', '');
    let stats: fs.Stats;

    try {
      stats = fs.statSync(filePath);
    } catch (err) {
      logger.debug(
        { filePath, err },
        'Could not stat file, it might have been moved or deleted already',
      );
      return;
    }

    const fileEvent: FileEvent = {
      path: filePath,
      name: fileName,
      size: stats.size,
      extension,
    };

    const allowedFilterIds = options.filterIds ? new Set(options.filterIds) : null;

    const filters = getAllFilters(this.db).filter((filter) =>
      this.shouldEvaluateFilter(filter, eventType, allowedFilterIds),
    );

    for (const filter of filters) {
      try {
        if (await this.matches(filter, fileEvent, eventType)) {
          logger.info(
            { filterId: filter.id, filterName: filter.name, file: fileName },
            'Filter match detected',
          );
          await this.executeAction(filter, fileEvent);
          await this.notificationService.notifyFilterMatch(filter, fileEvent);
        }
      } catch (err: any) {
        logger.error({ filterId: filter.id, err: err.message }, 'Error processing filter');
      }
    }
  }

  private shouldEvaluateFilter(
    filter: FilterRow,
    eventType: FilterEventType,
    allowedFilterIds: Set<number> | null,
  ): boolean {
    if (filter.enabled !== 1) return false;
    if (allowedFilterIds && !allowedFilterIds.has(filter.id)) return false;
    if (filter.trigger_source !== eventType) return false;

    if (eventType === 'watcher') {
      return normalizeFilterTargetPath(filter.target_path) !== null;
    }

    return true;
  }

  private async matches(
    filter: FilterRow,
    file: FileEvent,
    eventType: FilterEventType,
  ): Promise<boolean> {
    // 1. Check target path if specified
    const hasConfiguredTargetPath = typeof filter.target_path === 'string' && filter.target_path.trim().length > 0;
    if (hasConfiguredTargetPath) {
      if (!isPathWithinTarget(file.path, filter.target_path as string)) {
        return false;
      }
    } else if (eventType === 'watcher') {
      return false;
    }

    // 2. Evaluate rule
    switch (filter.rule_type) {
      case 'extension': {
        const allowed = filter.rule_payload
          .toLowerCase()
          .split(',')
          .map((e) => e.trim());
        return allowed.includes(file.extension);
      }
      case 'regex': {
        const regex = new RegExp(filter.rule_payload || '', 'i');
        return regex.test(file.name);
      }
      case 'size': {
        return this.evaluateSizeRule(filter.rule_payload, file.size);
      }
      case 'script': {
        const runtime = normalizeScriptRuntime(filter.script_runtime);
        const result = await runConfiguredScript(filter.rule_payload, { file }, runtime);
        return result.success && didScriptRuleMatch(result.output, runtime);
      }
      default:
        return false;
    }
  }

  private evaluateSizeRule(payload: string, fileSize: number): boolean {
    // e.g. >100MB, <1KB, =500B
    const match = /^([><=])?\s*(\d+(?:\.\d+)?)\s*([KMGT]B|B)?$/i.exec(payload);
    if (!match) return false;

    const operator = match[1] || '=';
    const value = parseFloat(match[2] || '0');
    const unit = (match[3] || 'B').toUpperCase();

    const units: Record<string, number> = {
      B: 1,
      KB: 1024,
      MB: 1024 * 1024,
      GB: 1024 * 1024 * 1024,
      TB: 1024 * 1024 * 1024 * 1024,
    };

    const bytes = value * (units[unit] || 1);

    if (operator === '>') return fileSize > bytes;
    if (operator === '<') return fileSize < bytes;
    return fileSize === bytes;
  }

  private async executeAction(filter: FilterRow, file: FileEvent) {
    const actionType = filter.action_type;
    const actionPayload = filter.action_payload;

    switch (actionType) {
      case 'delete':
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
          logger.info({ file: file.path }, 'Deleted file per filter action');
        }
        break;

      case 'move':
        if (actionPayload && fs.existsSync(file.path)) {
          const dest = path.join(actionPayload, file.name);
          if (!fs.existsSync(actionPayload)) {
            fs.mkdirSync(actionPayload, { recursive: true });
          }
          fs.renameSync(file.path, dest);
          logger.info({ from: file.path, to: dest }, 'Moved file per filter action');
        }
        break;

      case 'blocklist':
        await this.handleBlocklist(filter, file);
        break;

      case 'script':
        if (actionPayload) {
          await runConfiguredScript(
            actionPayload,
            { file, filter },
            normalizeScriptRuntime(filter.script_runtime),
          );
        }
        break;

      case 'notify':
        // Handled separately by sendNotification if enabled,
        // but if used as primary action, we can trigger it anyway
        break;
    }
  }

  private async handleBlocklist(filter: FilterRow, file: FileEvent) {
    if (!filter.instance_id) {
      logger.warn({ filterId: filter.id }, 'Blocklist action triggered but no instance linked');
      return;
    }

    const config = getInstanceConfigById(this.db, filter.instance_id);
    if (!config) {
      logger.error(
        { filterId: filter.id, instanceId: filter.instance_id },
        'Linked instance config not found',
      );
      return;
    }

    const client = createArrClient(
      config.type as any,
      config.url,
      config.apiKey,
      config.timeout,
      config.skipSslVerify,
    );

    try {
      // Try to find the item in the queue first
      const queue = await client.getQueue(1, 100);

      // Path mapping translation
      const translateLocToRem = (localPath: string) => {
        if (config.remotePath && config.localPath) {
          const absLocalMapping = path.resolve(config.localPath);
          const absFile = path.resolve(localPath);
          if (absFile.startsWith(absLocalMapping)) {
            const relative = absFile.slice(absLocalMapping.length);
            return path.join(config.remotePath, relative);
          }
        }
        return localPath;
      };

      const translatedPath = translateLocToRem(file.path);

      const matchingItem = queue.records.find((r) => {
        if (!r.outputPath) return false;
        const resPath = path.resolve(translatedPath);
        const outPath = path.resolve(r.outputPath);
        return resPath.startsWith(outPath);
      });

      if (matchingItem) {
        logger.info(
          { instance: config.name, title: matchingItem.title },
          'Found matching release in queue, blocklisting...',
        );
        await client.blocklistAndRemove(matchingItem.id);
        logger.info(
          { instance: config.name, title: matchingItem.title },
          'Successfully blocklisted release',
        );
      } else {
        logger.debug(
          { instance: config.name, file: file.name },
          'Could not find matching release in queue for blocklisting',
        );
      }
    } catch (err: any) {
      logger.error(
        { instance: config.name, err: err.message },
        'Failed to perform blocklist action',
      );
    }
  }
}
