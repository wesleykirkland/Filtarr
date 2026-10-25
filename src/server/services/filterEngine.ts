import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { logger } from '../lib/logger.js';
import { getAllFilters, type FilterRow } from '../../db/schemas/filters.js';
import { getInstanceConfigById } from '../../db/schemas/instances.js';
import { createArrClient } from '../routes/instances.js';
import {
  DEFAULT_BLOCKLIST_BEHAVIOR,
  isBlocklistBehavior,
  type BlocklistBehavior,
} from '../../shared/blocklistBehavior.js';
import { recordActivityEvent } from '../lib/activity.js';
import { getFilterPathViolation, isPathWithinTarget, normalizeFilterTargetPath } from './filterPaths.js';
import { getRegexPayloadViolation, parseExtensionPayload, parseSizePayload } from './filterRules.js';
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

/** Filenames longer than this are never tested against regex rules. */
export const MAX_REGEX_SUBJECT_LENGTH = 512;

interface ProcessFileOptions {
  filterIds?: number[];
}

export class FilterEngine {
  private readonly db: Database.Database;
  private readonly notificationService: NotificationService;
  private readonly regexCache = new Map<number, { payload: string; regex: RegExp | null }>();

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
    // 1. Check target path. Watcher and cron filters must have a permitted target.
    const hasConfiguredTargetPath = typeof filter.target_path === 'string' && filter.target_path.trim().length > 0;
    if (hasConfiguredTargetPath) {
      if (!isPathWithinTarget(file.path, filter.target_path as string)) {
        return false;
      }
      if (eventType !== 'manual') {
        const violation = getFilterPathViolation(filter.target_path as string, 'Target path');
        if (violation) {
          logger.warn({ filterId: filter.id, violation }, 'Skipping filter with disallowed target path');
          return false;
        }
      }
    } else if (eventType !== 'manual') {
      return false;
    }

    // 2. Evaluate rule
    switch (filter.rule_type) {
      case 'extension': {
        if (!file.extension) return false;
        const allowed = parseExtensionPayload(filter.rule_payload) ?? [];
        return allowed.includes(file.extension);
      }
      case 'regex': {
        if (file.name.length > MAX_REGEX_SUBJECT_LENGTH) return false;
        const regex = this.getCompiledRegex(filter);
        return regex ? regex.test(file.name) : false;
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

  /** Compile (and cache per filter) a regex rule; unsafe or invalid payloads never match. */
  private getCompiledRegex(filter: FilterRow): RegExp | null {
    const payload = filter.rule_payload || '';
    const cached = this.regexCache.get(filter.id);
    if (cached && cached.payload === payload) return cached.regex;

    const violation = getRegexPayloadViolation(payload);
    if (violation) {
      logger.warn({ filterId: filter.id, violation }, 'Regex rule rejected; filter will not match');
    }
    const regex = violation ? null : new RegExp(payload, 'i');
    this.regexCache.set(filter.id, { payload, regex });
    return regex;
  }

  private evaluateSizeRule(payload: string, fileSize: number): boolean {
    // e.g. >100MB, <1KB, =500B, >2G
    const parsed = parseSizePayload(payload);
    if (!parsed) return false;

    if (parsed.operator === '>') return fileSize > parsed.bytes;
    if (parsed.operator === '<') return fileSize < parsed.bytes;
    return fileSize === parsed.bytes;
  }

  /**
   * Resolve the real location of `file` (symlinks in its directory chain resolved,
   * the entry itself left as-is) and confirm it is still inside the filter's
   * target path and not in a blocked location. Returns null when unsafe.
   */
  private resolveContainedSource(filter: FilterRow, file: FileEvent): string | null {
    const targetPath = normalizeFilterTargetPath(filter.target_path);
    if (!targetPath) {
      logger.warn({ filterId: filter.id, file: file.path }, 'Skipping file action: filter has no target path');
      return null;
    }

    let realSource: string;
    let realTarget: string;
    try {
      realSource = path.join(fs.realpathSync(path.dirname(path.resolve(file.path))), path.basename(file.path));
      realTarget = fs.realpathSync(targetPath);
    } catch (err) {
      logger.warn(
        { filterId: filter.id, file: file.path, err: err instanceof Error ? err.message : String(err) },
        'Skipping file action: path not resolvable',
      );
      return null;
    }

    if (
      !isPathWithinTarget(realSource, realTarget) ||
      realSource === realTarget ||
      getFilterPathViolation(realSource, 'File path')
    ) {
      logger.warn(
        { filterId: filter.id, file: file.path, realPath: realSource, targetPath: realTarget },
        'Skipping file action: file resolves outside the filter target path',
      );
      return null;
    }
    return realSource;
  }

  private moveFile(filter: FilterRow, source: string, destinationDir: string) {
    const violation = getFilterPathViolation(destinationDir, 'Move destination');
    if (violation) {
      logger.warn({ filterId: filter.id, destination: destinationDir, violation }, 'Skipping move: destination not allowed');
      return;
    }

    const destDir = path.resolve(destinationDir.trim());
    fs.mkdirSync(destDir, { recursive: true });
    const realDestDir = fs.realpathSync(destDir);
    const realViolation = getFilterPathViolation(realDestDir, 'Move destination');
    if (realViolation) {
      logger.warn({ filterId: filter.id, destination: realDestDir, violation: realViolation }, 'Skipping move: destination not allowed');
      return;
    }

    const dest = path.join(realDestDir, path.basename(source));
    let destinationExists = true;
    try {
      fs.lstatSync(dest);
    } catch {
      destinationExists = false;
    }
    if (destinationExists) {
      logger.warn({ filterId: filter.id, from: source, to: dest }, 'Skipping move: destination file already exists');
      recordActivityEvent(this.db, {
        type: 'run',
        source: 'filters',
        message: `Filter "${filter.name}" did not move ${path.basename(source)} because the destination already exists`,
        details: { filterId: filter.id, status: 'skipped', from: source, to: dest },
      });
      return;
    }

    try {
      fs.renameSync(source, dest);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
      // Cross-device: copy without clobbering, then remove the source.
      fs.copyFileSync(source, dest, fs.constants.COPYFILE_EXCL);
      fs.unlinkSync(source);
    }
    logger.info({ from: source, to: dest }, 'Moved file per filter action');
  }

  private async executeAction(filter: FilterRow, file: FileEvent) {
    const actionType = filter.action_type;
    const actionPayload = filter.action_payload;

    switch (actionType) {
      case 'delete': {
        if (!fs.existsSync(file.path)) break;
        const source = this.resolveContainedSource(filter, file);
        if (!source) break;
        fs.unlinkSync(source);
        logger.info({ file: source }, 'Deleted file per filter action');
        break;
      }

      case 'move': {
        if (!actionPayload || !fs.existsSync(file.path)) break;
        const source = this.resolveContainedSource(filter, file);
        if (!source) break;
        this.moveFile(filter, source, actionPayload);
        break;
      }

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

    const behavior = this.resolveBlocklistBehavior(filter);

    const client = createArrClient(
      config.type,
      config.url,
      config.apiKey,
      config.timeout,
      config.skipSslVerify,
    );

    try {
      // Try to find the item in the queue (paginating through all items)
      const queueItems = await client.getAllQueueItems();

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

      const matchingItem = queueItems.find((r) => {
        if (!r.outputPath) return false;
        return isPathWithinTarget(translatedPath, r.outputPath);
      });

      if (!matchingItem) {
        logger.debug(
          { instance: config.name, file: file.name },
          'Could not find matching release in queue for blocklisting',
        );
        return;
      }

      logger.info(
        { instance: config.name, title: matchingItem.title, behavior },
        'Found matching release in queue, executing blocklist behavior...',
      );

      switch (behavior) {
        case 'blocklist_and_search':
          // Arr-native redownload: the Arr searches for a replacement itself.
          await client.deleteQueueItem(matchingItem.id, {
            blocklist: true,
            removeFromClient: true,
            skipRedownload: false,
          });
          logger.info(
            { instance: config.name, title: matchingItem.title },
            'Blocklisted release and requested redownload',
          );
          break;

        case 'blocklist_only':
          await client.deleteQueueItem(matchingItem.id, {
            blocklist: true,
            removeFromClient: true,
            skipRedownload: true,
          });
          logger.info(
            { instance: config.name, title: matchingItem.title },
            'Blocklisted release (skip redownload)',
          );
          break;

        case 'remove_only':
          // skipRedownload only matters when blocklisting; keep the Arr default.
          await client.deleteQueueItem(matchingItem.id, {
            blocklist: false,
            removeFromClient: true,
            skipRedownload: false,
          });
          logger.info(
            { instance: config.name, title: matchingItem.title },
            'Removed release from queue without blocklisting',
          );
          break;

        default: {
          const unhandled: never = behavior;
          logger.error(
            { filterId: filter.id, behavior: unhandled },
            'Unhandled blocklist behavior; no action taken',
          );
        }
      }
    } catch (err: any) {
      logger.error(
        { instance: config.name, err: err.message },
        'Failed to perform blocklist action',
      );
    }
  }

  private resolveBlocklistBehavior(filter: FilterRow): BlocklistBehavior {
    const stored = filter.action_payload;
    if (stored === null || stored === '') return DEFAULT_BLOCKLIST_BEHAVIOR;
    if (isBlocklistBehavior(stored)) return stored;

    logger.error(
      { filterId: filter.id, actionPayload: stored, fallback: DEFAULT_BLOCKLIST_BEHAVIOR },
      'Invalid blocklist behavior stored on filter; falling back to default',
    );
    return DEFAULT_BLOCKLIST_BEHAVIOR;
  }
}
