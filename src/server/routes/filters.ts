import { Router, type Request, type Response, type NextFunction } from 'express';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import {
  SecurityPolicyError,
  assertCustomScriptsEnabled,
  validateWebhookUrl,
} from '../../services/security.js';
import {
  getAllFilters,
  getFilterById,
  createFilter,
  toFilterResponse,
  updateFilter,
  deleteFilter,
} from '../../db/schemas/filters.js';
import { recordActivityEvent } from '../lib/activity.js';
import { FILTER_PRESETS } from '../lib/filterPresets.js';
import { logger } from '../lib/logger.js';

const createFilterSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  triggerSource: z.enum(['watcher', 'cron', 'manual']),
  ruleType: z.enum(['regex', 'extension', 'size', 'script']),
  rulePayload: z.string().min(1, 'Rule payload is required'),
  actionType: z.enum(['blocklist', 'delete', 'move', 'script', 'notify']),
  actionPayload: z.string().optional(),
  targetPath: z.string().optional(),
  notifyOnMatch: z.boolean().optional(),
  notifyWebhookUrl: z.string().url().optional().or(z.literal('')),
  notifySlack: z.boolean().optional(),
  notifySlackToken: z.string().optional(),
  notifySlackChannel: z.string().optional(),
  instanceId: z.number().int().optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

const updateFilterSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  triggerSource: z.enum(['watcher', 'cron', 'manual']).optional(),
  ruleType: z.enum(['regex', 'extension', 'size', 'script']).optional(),
  rulePayload: z.string().min(1).optional(),
  actionType: z.enum(['blocklist', 'delete', 'move', 'script', 'notify']).optional(),
  actionPayload: z.string().optional(),
  targetPath: z.string().optional(),
  notifyOnMatch: z.boolean().optional(),
  notifyWebhookUrl: z.string().url().optional().or(z.literal('')),
  notifySlack: z.boolean().optional(),
  notifySlackToken: z.string().optional(),
  notifySlackChannel: z.string().optional(),
  instanceId: z.number().int().optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

function validateFilterInputSecurity(
  data: z.infer<typeof createFilterSchema> | z.infer<typeof updateFilterSchema>,
  current?: ReturnType<typeof getFilterById>,
): void {
  const effectiveRuleType = data.ruleType ?? current?.rule_type;
  const effectiveActionType = data.actionType ?? current?.action_type;

  if (effectiveRuleType === 'script' || effectiveActionType === 'script') {
    assertCustomScriptsEnabled('Custom script filters');
  }

  if (data.notifyWebhookUrl) {
    data.notifyWebhookUrl = validateWebhookUrl(data.notifyWebhookUrl, {
      fieldName: 'notifyWebhookUrl',
    });
  }
}

export function createFiltersRoutes(db: Database.Database): Router {
  const router = Router();

  // GET /api/v1/filters
  router.get('/', (_req: Request, res: Response, next: NextFunction): void => {
    try {
      const filters = getAllFilters(db);
      res.json(filters.map(toFilterResponse));
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
      const id = parseInt((req.params['id'] as string) || '', 10);
      if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid ID' });
        return;
      }
      const filter = getFilterById(db, id);
      if (!filter) {
        res.status(404).json({ error: 'Filter not found' });
        return;
      }
      res.json(toFilterResponse(filter));
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/filters
  router.post('/', (req: Request, res: Response, next: NextFunction): void => {
    try {
      const data = createFilterSchema.parse(req.body);
      validateFilterInputSecurity(data);
      const filter = createFilter(db, data);
      logger.info({ filterId: filter.id, name: filter.name }, 'Filter created');
      recordActivityEvent(db, {
        type: 'created',
        source: 'filters',
        message: `Created filter "${filter.name}"`,
        details: {
          filterId: filter.id,
          triggerSource: filter.trigger_source,
          ruleType: filter.rule_type,
          actionType: filter.action_type,
          enabled: Boolean(filter.enabled),
        },
      });
      res.status(201).json(toFilterResponse(filter));
    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.issues[0]?.message || 'Invalid input' });
      } else if (err instanceof SecurityPolicyError) {
        res.status(400).json({ error: err.message });
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
      const id = parseInt((req.params['id'] as string) || '', 10);
      if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid ID' });
        return;
      }
      const current = getFilterById(db, id);
      if (!current) {
        res.status(404).json({ error: 'Filter not found' });
        return;
      }
      const data = updateFilterSchema.parse(req.body);
      validateFilterInputSecurity(data, current);
      const filter = updateFilter(db, id, data);
      logger.info({ filterId: filter.id }, 'Filter updated');
      recordActivityEvent(db, {
        type: 'updated',
        source: 'filters',
        message: `Updated filter "${filter.name}"`,
        details: {
          filterId: filter.id,
          triggerSource: filter.trigger_source,
          ruleType: filter.rule_type,
          actionType: filter.action_type,
          enabled: Boolean(filter.enabled),
          changedFields: Object.keys(data),
        },
      });
      res.json(toFilterResponse(filter));
    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.issues[0]?.message || 'Invalid input' });
      } else if (err instanceof SecurityPolicyError) {
        res.status(400).json({ error: err.message });
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
      const id = parseInt((req.params['id'] as string) || '', 10);
      if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid ID' });
        return;
      }
      const current = getFilterById(db, id);
      const success = deleteFilter(db, id);
      if (!success) {
        res.status(404).json({ error: 'Filter not found' });
        return;
      }
      logger.info({ filterId: id }, 'Filter deleted');
      recordActivityEvent(db, {
        type: 'deleted',
        source: 'filters',
        message: `Deleted filter "${current?.name || `#${id}`}"`,
        details: current
          ? {
              filterId: current.id,
              triggerSource: current.trigger_source,
              ruleType: current.rule_type,
              actionType: current.action_type,
            }
          : { filterId: id },
      });
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
