/**
 * CRUD API routes for managing Arr instance connections.
 *
 * All routes require authentication (applied at router level).
 * API keys are NEVER returned in plaintext — only masked versions.
 *
 * Routes:
 *   GET    /api/v1/instances          — List all instances
 *   GET    /api/v1/instances/:id      — Get instance by ID
 *   POST   /api/v1/instances          — Create new instance
 *   PUT    /api/v1/instances/:id      — Update instance
 *   DELETE /api/v1/instances/:id      — Delete instance
 *   POST   /api/v1/instances/test     — Test connection to an unsaved instance
 *                                       (pass instanceId without apiKey to reuse a stored key)
 *   GET    /api/v1/instances/:id/test — Test instance connection
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Database } from 'better-sqlite3';
import {
  getAllInstances,
  getInstanceById,
  getInstanceConfigById,
  createInstance,
  updateInstance,
  deleteInstance,
  type CreateInstanceInput,
  type UpdateInstanceInput,
} from '../../db/schemas/instances.js';
import type { ArrClient } from '../../services/arr/client.js';
import { SonarrClient } from '../../services/arr/sonarr.js';
import { RadarrClient } from '../../services/arr/radarr.js';
import { LidarrClient } from '../../services/arr/lidarr.js';
import {
  SecurityPolicyError,
  stripTrailingSlashes,
  validateArrInstanceUrl,
} from '../../services/security.js';
import type { ArrType } from '../../services/arr/types.js';
import { recordActivityEvent } from '../lib/activity.js';
import { logger } from '../lib/logger.js';

const VALID_ARR_TYPES: ArrType[] = ['sonarr', 'radarr', 'lidarr'];

function validateInstanceUrl(url: string, skipSslVerify?: boolean): string {
  return validateArrInstanceUrl(url, skipSslVerify, {
    fieldName: 'url',
  });
}

const arrTypeSchema = z.enum(['sonarr', 'radarr', 'lidarr'], {
  error: `type must be one of: ${VALID_ARR_TYPES.join(', ')}`,
});
const timeoutSchema = z
  .number({ error: 'timeout must be an integer between 1000 and 300000' })
  .int('timeout must be an integer between 1000 and 300000')
  .min(1000, 'timeout must be an integer between 1000 and 300000')
  .max(300000, 'timeout must be an integer between 1000 and 300000');
const optionalPathSchema = z.string({ error: 'paths must be strings' }).nullable().optional();

const createInstanceSchema = z.object({
  name: z.string({ error: 'name is required and must be a string' }).min(1, 'name is required and must be a string'),
  type: arrTypeSchema,
  url: z.string({ error: 'url is required and must be a string' }).min(1, 'url is required and must be a string'),
  apiKey: z.string({ error: 'apiKey is required and must be a string' }).min(1, 'apiKey is required and must be a string'),
  timeout: timeoutSchema.optional(),
  enabled: z.boolean({ error: 'enabled must be a boolean' }).optional(),
  skipSslVerify: z.boolean({ error: 'skipSslVerify must be a boolean' }).optional(),
  remotePath: optionalPathSchema,
  localPath: optionalPathSchema,
});

const updateInstanceSchema = z.object({
  name: z.string({ error: 'name must be a string' }).min(1, 'name must not be empty').optional(),
  type: arrTypeSchema.optional(),
  url: z.string({ error: 'url must be a string' }).min(1, 'url must not be empty').optional(),
  apiKey: z.string({ error: 'apiKey must be a string' }).optional(),
  timeout: timeoutSchema.optional(),
  enabled: z.boolean({ error: 'enabled must be a boolean' }).optional(),
  skipSslVerify: z.boolean({ error: 'skipSslVerify must be a boolean' }).optional(),
  remotePath: optionalPathSchema,
  localPath: optionalPathSchema,
});

const testInstanceSchema = z.object({
  type: arrTypeSchema,
  url: z.string({ error: 'url is required and must be a string' }).min(1, 'url is required and must be a string'),
  apiKey: z.string({ error: 'apiKey must be a string' }).optional(),
  instanceId: z.union([z.number().int(), z.string()]).nullable().optional(),
  timeout: timeoutSchema.optional(),
  skipSslVerify: z.boolean({ error: 'skipSslVerify must be a boolean' }).optional(),
});

function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message || 'Invalid input';
}

/**
 * Canonical form of an Arr URL used to decide whether a request targets the
 * same instance a stored API key belongs to (case-insensitive host, no
 * trailing slashes).
 */
function canonicalInstanceUrl(url: string): string {
  const parsed = new URL(stripTrailingSlashes(validateArrInstanceUrl(url, false, { fieldName: 'url' })));
  const pathname = stripTrailingSlashes(parsed.pathname);
  return `${parsed.protocol}//${parsed.host.toLowerCase()}${pathname}${parsed.search}`;
}

function parseInstanceId(raw: string | string[] | undefined): number | null {
  if (typeof raw !== 'string') return null;
  const id = Number.parseInt(raw, 10);
  return Number.isNaN(id) ? null : id;
}

/**
 * Create a typed Arr client for the given instance type.
 */
export function createArrClient(
  type: ArrType,
  url: string,
  apiKey: string,
  timeout?: number,
  skipSslVerify?: boolean,
): ArrClient {
  const options = { baseUrl: url, apiKey, timeout, skipSslVerify };
  switch (type) {
    case 'sonarr':
      return new SonarrClient(options);
    case 'radarr':
      return new RadarrClient(options);
    case 'lidarr':
      return new LidarrClient(options);
  }
}

const UPDATE_INSTANCE_FIELDS = [
  'name', 'type', 'url', 'apiKey', 'timeout',
  'enabled', 'skipSslVerify', 'remotePath', 'localPath',
] as const;

function buildUpdateInput(body: z.infer<typeof updateInstanceSchema>): UpdateInstanceInput {
  const input: UpdateInstanceInput = {};
  for (const field of UPDATE_INSTANCE_FIELDS) {
    if (body[field] !== undefined) {
      (input as Record<string, unknown>)[field] = body[field];
    }
  }
  // An empty apiKey means "keep the stored key".
  if (input.apiKey === '') delete input.apiKey;
  return input;
}

/**
 * Create the instances router.
 * @param db - The SQLite database instance
 */
export function createInstancesRouter(db: Database): Router {
  const router = Router();

  // GET /api/v1/instances — List all instances
  router.get('/', (_req: Request, res: Response) => {
    try {
      const instances = getAllInstances(db);
      res.json(instances);
    } catch (err) {
      logger.error({ err }, 'Failed to list instances');
      res.status(500).json({ error: 'Failed to list instances' });
    }
  });

  // GET /api/v1/instances/:id — Get instance by ID
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const id = parseInstanceId(req.params['id']);
      if (id === null) {
        res.status(400).json({ error: 'Invalid instance ID' });
        return;
      }

      const instance = getInstanceById(db, id);
      if (!instance) {
        res.status(404).json({ error: 'Instance not found' });
        return;
      }

      res.json(instance);
    } catch (err) {
      logger.error({ err, id: req.params['id'] }, 'Failed to get instance');
      res.status(500).json({ error: 'Failed to get instance' });
    }
  });

  // POST /api/v1/instances — Create new instance
  router.post('/', (req: Request, res: Response) => {
    try {
      const parsed = createInstanceSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: firstIssueMessage(parsed.error) });
        return;
      }
      const body = parsed.data;

      const normalizedUrl = validateInstanceUrl(body.url, body.skipSslVerify);

      const input: CreateInstanceInput = {
        name: body.name,
        type: body.type,
        url: normalizedUrl,
        apiKey: body.apiKey,
        timeout: body.timeout,
        enabled: body.enabled,
        skipSslVerify: body.skipSslVerify,
        remotePath: body.remotePath,
        localPath: body.localPath,
      };
      const instance = createInstance(db, input);
      logger.info({ instanceId: instance.id }, 'Created new Arr instance');
      recordActivityEvent(db, {
        type: 'created',
        source: 'instances',
        message: `Created ${instance.type} instance "${instance.name}"`,
        details: {
          instanceId: instance.id,
          instanceType: instance.type,
          enabled: instance.enabled,
          skipSslVerify: instance.skipSslVerify,
        },
      });
      res.status(201).json(instance);
    } catch (err: unknown) {
      if (err instanceof SecurityPolicyError) {
        res.status(400).json({ error: err.message });
        return;
      }
      const dbErr = err as { code?: string };
      if (dbErr.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        res.status(409).json({ error: 'Instance name already exists' });
        return;
      }
      logger.error({ err }, 'Failed to create instance');
      res.status(500).json({ error: 'Failed to create instance' });
    }
  });

  // PUT /api/v1/instances/:id — Update instance
  router.put('/:id', (req: Request, res: Response) => {
    try {
      const id = parseInstanceId(req.params['id']);
      if (id === null) {
        res.status(400).json({ error: 'Invalid instance ID' });
        return;
      }

      const current = getInstanceConfigById(db, id);
      if (!current) {
        res.status(404).json({ error: 'Instance not found' });
        return;
      }

      const parsed = updateInstanceSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: firstIssueMessage(parsed.error) });
        return;
      }

      const input = buildUpdateInput(parsed.data);

      const normalizedUrl = validateInstanceUrl(
        input.url ?? current.url,
        input.skipSslVerify ?? current.skipSslVerify,
      );
      if (input.url !== undefined) input.url = normalizedUrl;

      const instance = updateInstance(db, id, input);
      if (!instance) {
        res.status(404).json({ error: 'Instance not found' });
        return;
      }

      logger.info({ instanceId: instance.id }, 'Updated Arr instance');
      recordActivityEvent(db, {
        type: 'updated',
        source: 'instances',
        message: `Updated ${instance.type} instance "${instance.name}"`,
        details: {
          instanceId: instance.id,
          instanceType: instance.type,
          enabled: instance.enabled,
          skipSslVerify: instance.skipSslVerify,
          changedFields: Object.keys(input),
        },
      });
      res.json(instance);
    } catch (err) {
      if (err instanceof SecurityPolicyError) {
        res.status(400).json({ error: err.message });
        return;
      }
      logger.error({ err, id: req.params['id'] }, 'Failed to update instance');
      res.status(500).json({ error: 'Failed to update instance' });
    }
  });

  // DELETE /api/v1/instances/:id — Delete instance
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const id = parseInstanceId(req.params['id']);
      if (id === null) {
        res.status(400).json({ error: 'Invalid instance ID' });
        return;
      }

      const current = getInstanceById(db, id);
      const deleted = deleteInstance(db, id);
      if (!deleted) {
        res.status(404).json({ error: 'Instance not found' });
        return;
      }

      logger.info({ instanceId: id }, 'Deleted Arr instance');
      const instanceLabel = current?.name || `#${id}`;
      recordActivityEvent(db, {
        type: 'deleted',
        source: 'instances',
        message: `Deleted instance "${instanceLabel}"`,
        details: current
          ? { instanceId: current.id, instanceType: current.type, enabled: current.enabled }
          : { instanceId: id },
      });
      res.status(204).send();
    } catch (err) {
      logger.error({ err, id: req.params['id'] }, 'Failed to delete instance');
      res.status(500).json({ error: 'Failed to delete instance' });
    }
  });

  // POST /api/v1/instances/test — Test connection to an unsaved instance
  router.post('/test', async (req: Request, res: Response): Promise<void> => {
    let client: ArrClient | undefined;
    try {
      const parsed = testInstanceSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: firstIssueMessage(parsed.error) });
        return;
      }
      const { type, url, timeout, skipSslVerify, instanceId } = parsed.data;
      let apiKey = parsed.data.apiKey;

      const normalizedUrl = validateInstanceUrl(url, skipSslVerify);

      // When editing a saved instance without re-entering the key, fall back
      // to the stored (decrypted) key so the masked value is never sent
      // upstream — but only when the request targets the saved instance's own
      // URL, so a stored key can never be sent to a caller-chosen host.
      if (!apiKey && instanceId !== undefined && instanceId !== null) {
        const id = parseInstanceId(String(instanceId));
        if (id === null) {
          res.status(400).json({ error: 'Invalid instance ID' });
          return;
        }
        const existing = getInstanceConfigById(db, id);
        if (!existing) {
          res.status(404).json({ error: 'Instance not found' });
          return;
        }
        let sameUrl = false;
        try {
          sameUrl = canonicalInstanceUrl(normalizedUrl) === canonicalInstanceUrl(existing.url);
        } catch {
          sameUrl = false;
        }
        if (!sameUrl) {
          res.status(400).json({
            error: 'apiKey is required when testing a URL that differs from the saved instance URL',
          });
          return;
        }
        apiKey = existing.apiKey;
      }

      if (!apiKey) {
        res.status(400).json({ error: 'apiKey is required and must be a string' });
        return;
      }

      client = createArrClient(type, normalizedUrl, apiKey, timeout, skipSslVerify);
      // testConnection makes a single attempt and only returns generic error categories.
      const result = await client.testConnection();

      recordActivityEvent(db, {
        type: 'validation',
        source: 'instances',
        message: result.success
          ? `Connection test passed for unsaved ${type} instance`
          : `Connection test failed for unsaved ${type} instance`,
        details: {
          instanceType: type,
          url: normalizedUrl,
          success: result.success,
          error: result.errorCode,
        },
      });

      res.json(result);
    } catch (error) {
      if (error instanceof SecurityPolicyError) {
        res.status(400).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, 'Failed to test unsaved instance connection');
      res.status(500).json({ success: false, error: 'Connection test failed' });
    } finally {
      await client?.close().catch(() => undefined);
    }
  });

  // GET /api/v1/instances/:id/test — Test instance connection
  router.get('/:id/test', async (req: Request, res: Response) => {
    try {
      const id = parseInstanceId(req.params['id']);
      if (id === null) {
        res.status(400).json({ error: 'Invalid instance ID' });
        return;
      }

      const config = getInstanceConfigById(db, id);
      if (!config) {
        res.status(404).json({ error: 'Instance not found' });
        return;
      }

      const client = createArrClient(
        config.type,
        config.url,
        config.apiKey,
        config.timeout,
        config.skipSslVerify,
      );
      const result = await client.testConnection();

      recordActivityEvent(db, {
        type: 'validation',
        source: 'instances',
        message: result.success
          ? `Connection test passed for ${config.name}`
          : `Connection test failed for ${config.name}`,
        details: {
          instanceId: config.id,
          instanceType: config.type,
          success: result.success,
          error: result.error,
        },
      });

      res.json(result);
    } catch (error) {
      logger.error({ err: error, id: req.params['id'] }, 'Failed to test saved instance connection');
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Connection test failed',
      });
    }
  });

  return router;
}
