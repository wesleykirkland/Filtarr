import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { logger } from '../lib/logger.js';
import { getAllFilters, type FilterRow } from '../../db/schemas/filters.js';
import { getInstanceConfigById } from '../../db/schemas/instances.js';
import { createArrClient } from '../routes/instances.js';
import { runSandboxedScript } from './scriptRunner.js';

export interface FileEvent {
  path: string;
  name: string;
  size: number;
  extension: string;
}

export class FilterEngine {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Process a file through all applicable filters.
   */
  public async processFile(filePath: string, eventType: 'watcher' | 'cron' | 'manual' = 'watcher') {
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

    const filters = getAllFilters(this.db).filter((f) => f.enabled === 1);

    for (const filter of filters) {
      try {
        if (await this.matches(filter, fileEvent)) {
          logger.info(
            { filterId: filter.id, filterName: filter.name, file: fileName },
            'Filter match detected',
          );
          await this.executeAction(filter, fileEvent);

          if (filter.notify_on_match && filter.notify_webhook_url) {
            await this.sendNotification(filter, fileEvent);
          }
        }
      } catch (err: any) {
        logger.error({ filterId: filter.id, err: err.message }, 'Error processing filter');
      }
    }
  }

  private async matches(filter: FilterRow, file: FileEvent): Promise<boolean> {
    // 1. Check target path if specified
    if (filter.target_path) {
      const absoluteTarget = path.resolve(filter.target_path);
      const absoluteFile = path.resolve(file.path);
      if (!absoluteFile.startsWith(absoluteTarget)) {
        return false;
      }
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
        const result = await runSandboxedScript(filter.rule_payload, { file });
        return !!result.success && !!result.output;
      }
      default:
        return false;
    }
  }

  private evaluateSizeRule(payload: string, fileSize: number): boolean {
    // e.g. >100MB, <1KB, =500B
    const match = payload.match(/^([><=])?\s*(\d+(?:\.\d+)?)\s*([KMGT]B|B)?$/i);
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
          await runSandboxedScript(actionPayload, { file, filter });
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

  private async sendNotification(filter: FilterRow, file: FileEvent) {
    if (!filter.notify_webhook_url) return;

    const payload = {
      event: 'filter_match',
      filter: {
        id: filter.id,
        name: filter.name,
      },
      file: {
        path: file.path,
        name: file.name,
        size: file.size,
      },
      timestamp: new Date().toISOString(),
    };

    try {
      const response = await fetch(filter.notify_webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        logger.warn(
          { filterId: filter.id, status: response.status },
          'Webhook notification failed',
        );
      } else {
        logger.debug({ filterId: filter.id }, 'Webhook notification sent');
      }
    } catch (err: any) {
      logger.error({ filterId: filter.id, err: err.message }, 'Error sending webhook notification');
    }
  }
}
