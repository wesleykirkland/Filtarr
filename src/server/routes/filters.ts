import { Router, type Request, type Response, type NextFunction } from 'express';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import {
  getAllFilters,
  getFilterById,
  createFilter,
  updateFilter,
  deleteFilter,
  type FilterRow,
} from '../../db/schemas/filters.js';
import { FILTER_PRESETS } from '../lib/filterPresets.js';
import { logger } from '../lib/logger.js';
import { reloadWatcher } from '../services/watcher.js';
import { SecurityPolicyError, assertCustomScriptsEnabled } from '../../services/security.js';
import {
  BLOCKLIST_BEHAVIORS,
  DEFAULT_BLOCKLIST_BEHAVIOR,
  isBlocklistBehavior,
} from '../../shared/blocklistBehavior.js';
import { getFilterPathViolation } from '../services/filterPaths.js';
import {
  getRegexPayloadViolation,
  normalizeSizePayload,
  parseExtensionPayload,
} from '../services/filterRules.js';

class FilterInputError extends Error {}

interface FilterPolicyInput {
  triggerSource?: string;
  ruleType?: string;
  rulePayload?: string;
  actionType?: string;
  actionPayload?: string;
  targetPath?: string;
}

/**
 * Validate and normalize rule payloads, target paths and move destinations against
 * the effective (merged) filter state. Only fields touched by the request (or
 * whose meaning changes with it) are checked so unrelated edits such as toggling
 * `enabled` keep working on legacy rows. Throws FilterInputError on rejection.
 */
function applyFilterInputPolicy<T extends FilterPolicyInput>(data: T, current?: FilterRow | null): T {
  const result = { ...data };

  if (data.ruleType !== undefined || data.rulePayload !== undefined) {
    const ruleType = data.ruleType ?? current?.rule_type;
    const rulePayload = data.rulePayload ?? current?.rule_payload ?? '';
    if (ruleType === 'regex') {
      const violation = getRegexPayloadViolation(rulePayload);
      if (violation) throw new FilterInputError(violation);
    } else if (ruleType === 'size') {
      const normalized = normalizeSizePayload(rulePayload);
      if (!normalized) {
        throw new FilterInputError(
          'Size rule must look like ">100MB" (operator <, > or =, then a number and a unit of B, KB, MB, GB or TB)',
        );
      }
      result.rulePayload = normalized;
    } else if (ruleType === 'extension') {
      const extensions = parseExtensionPayload(rulePayload, true);
      if (!extensions) {
        throw new FilterInputError(
          'Extension rule must be a comma-separated list of extensions using only letters and digits (e.g. "exe, msi")',
        );
      }
      result.rulePayload = extensions.join(',');
    }
  }

  if (data.triggerSource !== undefined || data.targetPath !== undefined) {
    const triggerSource = data.triggerSource ?? current?.trigger_source;
    const targetPath = (data.targetPath ?? current?.target_path ?? '').trim();
    if (!targetPath && (triggerSource === 'watcher' || triggerSource === 'cron')) {
      throw new FilterInputError('Target path is required for watcher and cron filters');
    }
    if (targetPath) {
      const violation = getFilterPathViolation(targetPath, 'Target path');
      if (violation) throw new FilterInputError(violation);
    }
    if (data.targetPath !== undefined) result.targetPath = data.targetPath.trim();
  }

  if (data.actionType !== undefined || data.actionPayload !== undefined) {
    const actionType = data.actionType ?? current?.action_type;
    if (actionType === 'move') {
      const destination = (data.actionPayload ?? current?.action_payload ?? '').trim();
      const violation = getFilterPathViolation(destination, 'Move destination');
      if (violation) throw new FilterInputError(violation);
      result.actionPayload = destination;
    }
  }

  return result;
}

/**
 * For blocklist filters, default a missing/empty actionPayload to the default
 * Arr behavior and reject any other value outside the allowed set.
 */
function normalizeBlocklistPayload<T extends { actionType?: string; actionPayload?: string }>(
  data: T,
  ctx: z.RefinementCtx,
): T {
  if (data.actionType !== 'blocklist') return data;

  if (data.actionPayload === undefined || data.actionPayload === '') {
    return { ...data, actionPayload: DEFAULT_BLOCKLIST_BEHAVIOR };
  }

  if (!isBlocklistBehavior(data.actionPayload)) {
    ctx.addIssue({
      code: 'custom',
      message: `actionPayload must be one of: ${BLOCKLIST_BEHAVIORS.join(', ')} when actionType is 'blocklist'`,
      path: ['actionPayload'],
    });
    return z.NEVER;
  }

  return data;
}

export const createFilterSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  triggerSource: z.enum(['watcher', 'cron', 'manual']),
  ruleType: z.enum(['regex', 'extension', 'size', 'script']),
  rulePayload: z.string().min(1, 'Rule payload is required'),
  actionType: z.enum(['blocklist', 'delete', 'move', 'script', 'notify']),
  actionPayload: z.string().optional(),
  scriptRuntime: z.enum(['shell', 'javascript']).default('shell'),
  targetPath: z.string().optional(),
  notifyOnMatch: z.boolean().optional(),
  notifyWebhookUrl: z.string().url().optional().or(z.literal('')),
  notifySlack: z.boolean().optional(),
  notifySlackToken: z.string().optional(),
  notifySlackChannel: z.string().optional(),
  overrideNotifications: z.boolean().optional(),
  instanceId: z.number().int().optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
}).transform(normalizeBlocklistPayload);

const updateFilterSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  triggerSource: z.enum(['watcher', 'cron', 'manual']).optional(),
  ruleType: z.enum(['regex', 'extension', 'size', 'script']).optional(),
  rulePayload: z.string().min(1).optional(),
  actionType: z.enum(['blocklist', 'delete', 'move', 'script', 'notify']).optional(),
  actionPayload: z.string().optional(),
  scriptRuntime: z.enum(['shell', 'javascript']).optional(),
  targetPath: z.string().optional(),
  notifyOnMatch: z.boolean().optional(),
  notifyWebhookUrl: z.string().url().optional().or(z.literal('')),
  notifySlack: z.boolean().optional(),
  notifySlackToken: z.string().optional(),
  notifySlackChannel: z.string().optional(),
  overrideNotifications: z.boolean().optional(),
  instanceId: z.number().int().optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
}).transform(normalizeBlocklistPayload);

export function createFiltersRoutes(db: Database.Database): Router {
  const router = Router();

  // GET /api/v1/filters
  router.get('/', (_req: Request, res: Response, next: NextFunction): void => {
    try {
      const filters = getAllFilters(db);
      res.json(filters);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/filters/presets
  router.get('/presets', (_req: Request, res: Response): void => {
    res.json(FILTER_PRESETS);
  });

  // GET /api/v1/filters/:id
  router.get('/:id', (req: Request, res: Response, next: NextFunction): void => {
    try {
      const id = Number.parseInt((req.params['id'] as string) || '', 10);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: 'Invalid ID' });
        return;
      }
      const filter = getFilterById(db, id);
      if (!filter) {
        res.status(404).json({ error: 'Filter not found' });
        return;
      }
      res.json(filter);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/filters
  router.post('/', (req: Request, res: Response, next: NextFunction): void => {
    try {
      const data = applyFilterInputPolicy(createFilterSchema.parse(req.body));
      if (data.ruleType === 'script' || data.actionType === 'script') {
        assertCustomScriptsEnabled('Custom script filters');
      }
      const filter = createFilter(db, data);
      logger.info({ filterId: filter.id, name: filter.name }, 'Filter created');
      reloadWatcher();
      res.status(201).json(filter);
    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.issues[0]?.message || 'Invalid input' });
      } else if (err instanceof FilterInputError) {
        res.status(400).json({ error: err.message });
      } else if (err instanceof SecurityPolicyError) {
        res.status(403).json({ error: err.message });
      } else if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        res.status(409).json({ error: 'A filter with this name already exists' });
      } else {
        next(err);
      }
    }
  });

  // PUT /api/v1/filters/:id
  router.put('/:id', (req: Request, res: Response, next: NextFunction): void => {
    try {
      const id = Number.parseInt((req.params['id'] as string) || '', 10);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: 'Invalid ID' });
        return;
      }
      const parsed = updateFilterSchema.parse(req.body);
      // Block introducing or editing script logic while the feature is disabled.
      // Other edits (e.g. disabling an existing script filter) remain allowed.
      const current = getFilterById(db, id);
      const data = applyFilterInputPolicy(parsed, current);
      const ruleIsScript = (data.ruleType ?? current?.rule_type) === 'script';
      const actionIsScript = (data.actionType ?? current?.action_type) === 'script';
      const touchesScript =
        data.ruleType === 'script' ||
        data.actionType === 'script' ||
        (ruleIsScript && data.rulePayload !== undefined) ||
        (actionIsScript && data.actionPayload !== undefined) ||
        ((ruleIsScript || actionIsScript) && data.scriptRuntime !== undefined);
      if (touchesScript) {
        assertCustomScriptsEnabled('Custom script filters');
      }
      const filter = updateFilter(db, id, data);
      logger.info({ filterId: filter.id }, 'Filter updated');
      reloadWatcher();
      res.json(filter);
    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.issues[0]?.message || 'Invalid input' });
      } else if (err instanceof FilterInputError) {
        res.status(400).json({ error: err.message });
      } else if (err instanceof SecurityPolicyError) {
        res.status(403).json({ error: err.message });
      } else if (
        (err as { code?: string }).code === 'FILTER_INSTANCE_NOT_FOUND' ||
        (err as { code?: string }).code === 'SQLITE_CONSTRAINT_FOREIGNKEY'
      ) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid linked instance' });
      } else if (err instanceof Error && err.message.includes('not found')) {
        res.status(404).json({ error: err.message });
      } else if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        res.status(409).json({ error: 'A filter with this name already exists' });
      } else {
        next(err);
      }
    }
  });

  // DELETE /api/v1/filters/:id
  router.delete('/:id', (req: Request, res: Response, next: NextFunction): void => {
    try {
      const id = Number.parseInt((req.params['id'] as string) || '', 10);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: 'Invalid ID' });
        return;
      }
      const success = deleteFilter(db, id);
      if (!success) {
        res.status(404).json({ error: 'Filter not found' });
        return;
      }
      logger.info({ filterId: id }, 'Filter deleted');
      reloadWatcher();
      res.json({ success: true, message: 'Filter deleted successfully' });
    } catch (err) {
      if (err instanceof Error && err.message.includes('Built-in filters')) {
        res.status(403).json({ error: err.message });
      } else {
        next(err);
      }
    }
  });

  return router;
}
