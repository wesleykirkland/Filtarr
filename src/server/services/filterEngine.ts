import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { logger } from '../lib/logger.js';
import { getAllFilters, type FilterRow } from '../../db/schemas/filters.js';
import { getInstanceConfigById } from '../../db/schemas/instances.js';
import { recordActivityEvent } from '../lib/activity.js';
import { SecurityPolicyError, validateWebhookUrl } from '../../services/security.js';
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
          recordActivityEvent(this.db, {
            type: 'matched',
            source: 'filters',
            message: `Filter "${filter.name}" matched ${fileName}`,
            details: {
              filterId: filter.id,
              filterName: filter.name,
              trigger: eventType,
              ruleType: filter.rule_type,
              actionType: filter.action_type,
              filePath: fileEvent.path,
              fileName: fileEvent.name,
            },
          });
          await this.executeAction(filter, fileEvent);

          if (filter.notify_on_match && filter.notify_webhook_url) {
            await this.sendNotification(filter, fileEvent);
          }
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error({ filterId: filter.id, err: errorMessage }, 'Error processing filter');
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
          recordActivityEvent(this.db, {
            type: 'action',
            source: 'filters',
            message: `Deleted ${file.name} via filter "${filter.name}"`,
            details: { filterId: filter.id, actionType: 'delete', filePath: file.path, fileName: file.name },
          });
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
          recordActivityEvent(this.db, {
            type: 'action',
            source: 'filters',
            message: `Moved ${file.name} via filter "${filter.name}"`,
            details: {
              filterId: filter.id,
              actionType: 'move',
              filePath: file.path,
              destinationPath: dest,
              fileName: file.name,
            },
          });
        }
        break;

      case 'blocklist':
        await this.handleBlocklist(filter, file);
        break;

      case 'script':
        if (actionPayload) {
          await runSandboxedScript(actionPayload, { file, filter });
          recordActivityEvent(this.db, {
            type: 'action',
            source: 'filters',
            message: `Ran custom action for ${file.name} via filter "${filter.name}"`,
            details: { filterId: filter.id, actionType: 'script', filePath: file.path, fileName: file.name },
          });
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
      recordActivityEvent(this.db, {
        type: 'action',
        source: 'filters',
        message: `Blocklist action skipped for filter "${filter.name}" because no instance is linked`,
        details: { filterId: filter.id, actionType: 'blocklist', status: 'skipped', filePath: file.path },
      });
      return;
    }

    const config = getInstanceConfigById(this.db, filter.instance_id);
    if (!config) {
      logger.error(
        { filterId: filter.id, instanceId: filter.instance_id },
        'Linked instance config not found',
      );
      recordActivityEvent(this.db, {
        type: 'action',
        source: 'filters',
        message: `Blocklist action failed for filter "${filter.name}" because the linked instance no longer exists`,
        details: {
          filterId: filter.id,
          actionType: 'blocklist',
          status: 'failure',
          instanceId: filter.instance_id,
          filePath: file.path,
        },
      });
      return;
    }

    const client = createArrClient(
      config.type,
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
        recordActivityEvent(this.db, {
          type: 'action',
          source: 'filters',
          message: `Blocklisted "${matchingItem.title}" via filter "${filter.name}"`,
          details: {
            filterId: filter.id,
            actionType: 'blocklist',
            status: 'success',
            instanceId: config.id,
            queueItemId: matchingItem.id,
            filePath: file.path,
          },
        });
      } else {
        logger.debug(
          { instance: config.name, file: file.name },
          'Could not find matching release in queue for blocklisting',
        );
        recordActivityEvent(this.db, {
          type: 'action',
          source: 'filters',
          message: `No matching queue item was found to blocklist for ${file.name}`,
          details: {
            filterId: filter.id,
            actionType: 'blocklist',
            status: 'skipped',
            instanceId: config.id,
            filePath: file.path,
          },
        });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error(
        { instance: config.name, err: errorMessage },
        'Failed to perform blocklist action',
      );
      recordActivityEvent(this.db, {
        type: 'action',
        source: 'filters',
        message: `Blocklist action failed for ${file.name}`,
        details: {
          filterId: filter.id,
          actionType: 'blocklist',
          status: 'failure',
          instanceId: config.id,
          filePath: file.path,
          error: errorMessage,
        },
      });
    }
  }

  private async sendNotification(filter: FilterRow, file: FileEvent) {
    if (!filter.notify_webhook_url) return;

    let webhookUrl: string;
    try {
      webhookUrl = validateWebhookUrl(filter.notify_webhook_url, {
        fieldName: 'notify_webhook_url',
      });
    } catch (error) {
      if (error instanceof SecurityPolicyError) {
        logger.warn({ filterId: filter.id, error: error.message }, 'Blocked unsafe notification webhook');
        return;
      }
      throw error;
    }

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
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        logger.warn(
          { filterId: filter.id, status: response.status },
          'Webhook notification failed',
        );
        recordActivityEvent(this.db, {
          type: 'notification',
          source: 'filters',
          message: `Notification delivery failed for filter "${filter.name}"`,
          details: {
            filterId: filter.id,
            filePath: file.path,
            fileName: file.name,
            status: response.status,
            success: false,
          },
        });
      } else {
        logger.debug({ filterId: filter.id }, 'Webhook notification sent');
        recordActivityEvent(this.db, {
          type: 'notification',
          source: 'filters',
          message: `Notification sent for filter "${filter.name}"`,
          details: {
            filterId: filter.id,
            filePath: file.path,
            fileName: file.name,
            status: response.status,
            success: true,
          },
        });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error({ filterId: filter.id, err: errorMessage }, 'Error sending webhook notification');
      recordActivityEvent(this.db, {
        type: 'notification',
        source: 'filters',
        message: `Notification errored for filter "${filter.name}"`,
        details: {
          filterId: filter.id,
          filePath: file.path,
          fileName: file.name,
          success: false,
          error: errorMessage,
        },
      });
    }
  }
}
