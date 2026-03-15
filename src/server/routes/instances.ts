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
 *   GET    /api/v1/instances/:id/test — Test instance connection
 */

import { Router, type Request, type Response } from 'express';
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
  validateArrInstanceUrl,
} from '../../services/security.js';
import type { ArrType } from '../../services/arr/types.js';
import { recordActivityEvent } from '../lib/activity.js';
import { logger } from '../lib/logger.js';

const VALID_ARR_TYPES: ArrType[] = ['sonarr', 'radarr', 'lidarr'];

// Timeout limits to prevent resource exhaustion (CodeQL: CWE-400)
const MIN_TIMEOUT_MS = 1000; // 1 second
const MAX_TIMEOUT_MS = 300000; // 5 minutes

function validateInstanceUrl(url: string, skipSslVerify?: boolean): string {
  return validateArrInstanceUrl(url, skipSslVerify, {
    fieldName: 'url',
  });
}

/**
 * Validate and sanitize timeout value to prevent resource exhaustion.
 * Returns a safe timeout value within acceptable bounds.
 */
function validateTimeout(timeout: unknown): number {
  if (timeout === undefined || timeout === null) {
    return 30000; // Default 30 seconds
  }

  let timeoutNum: number;
  if (typeof timeout === 'number') {
    timeoutNum = timeout;
  } else if (typeof timeout === 'string') {
    const trimmed = timeout.trim();
    if (trimmed.length === 0) return 30000;
    timeoutNum = Number.parseInt(trimmed, 10);
  } else {
    return 30000;
  }

  if (Number.isNaN(timeoutNum) || timeoutNum < MIN_TIMEOUT_MS) {
    return MIN_TIMEOUT_MS;
  }

  if (timeoutNum > MAX_TIMEOUT_MS) {
    return MAX_TIMEOUT_MS;
  }

  return timeoutNum;
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
      const id = Number.parseInt(req.params['id'] as string, 10);
      if (Number.isNaN(id)) {
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
      const { name, type, url, apiKey, timeout, enabled } = req.body as CreateInstanceInput;

      // Validate required fields
      if (!name || typeof name !== 'string') {
        res.status(400).json({ error: 'name is required and must be a string' });
        return;
      }
      if (!type || !VALID_ARR_TYPES.includes(type)) {
        res.status(400).json({ error: `type must be one of: ${VALID_ARR_TYPES.join(', ')}` });
        return;
      }
      if (!url || typeof url !== 'string') {
        res.status(400).json({ error: 'url is required and must be a string' });
        return;
      }
      if (!apiKey || typeof apiKey !== 'string') {
        res.status(400).json({ error: 'apiKey is required and must be a string' });
        return;
      }

      const normalizedUrl = validateInstanceUrl(url, req.body.skipSslVerify);
      const validatedTimeout = validateTimeout(timeout);

      const instance = createInstance(db, {
        name,
        type,
        url: normalizedUrl,
        apiKey,
        timeout: validatedTimeout,
        enabled,
        skipSslVerify: req.body.skipSslVerify,
        remotePath: req.body.remotePath,
        localPath: req.body.localPath,
      });
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
      const id = Number.parseInt(req.params['id'] as string, 10);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: 'Invalid instance ID' });
        return;
      }

      const body = req.body as Record<string, unknown>;
      const current = getInstanceConfigById(db, id);

      if (!current) {
        res.status(404).json({ error: 'Instance not found' });
        return;
      }

      const input = Object.fromEntries(
        Object.entries({
          name: body['name'],
          url: body['url'],
          apiKey: body['apiKey'],
          enabled: body['enabled'],
          skipSslVerify: body['skipSslVerify'],
          remotePath: body['remotePath'],
          localPath: body['localPath'],
        }).filter(([, value]) => value !== undefined),
      ) as UpdateInstanceInput;

      if (body['type'] !== undefined) {
        if (!VALID_ARR_TYPES.includes(body['type'] as ArrType)) {
          res.status(400).json({ error: `type must be one of: ${VALID_ARR_TYPES.join(', ')}` });
          return;
        }
        input.type = body['type'] as ArrType;
      }
      if (body['timeout'] !== undefined) input.timeout = validateTimeout(body['timeout']);

      const normalizedUrl = validateInstanceUrl(
        input.url ?? current.url,
        input.skipSslVerify ?? current.skipSslVerify,
      );
      if (body['url'] !== undefined) input.url = normalizedUrl;

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
      const id = Number.parseInt(req.params['id'] as string, 10);
      if (Number.isNaN(id)) {
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
      const displayName = current?.name ?? `#${id}`;
      recordActivityEvent(db, {
        type: 'deleted',
        source: 'instances',
        message: `Deleted instance "${displayName}"`,
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
    try {
      const { type, url, apiKey, timeout, skipSslVerify } = req.body;

      // Basic validation for required fields
      if (!type || !VALID_ARR_TYPES.includes(type)) {
        res.status(400).json({ error: `type must be one of: ${VALID_ARR_TYPES.join(', ')}` });
        return;
      }
      if (!url || typeof url !== 'string') {
        res.status(400).json({ error: 'url is required and must be a string' });
        return;
      }
      if (!apiKey || typeof apiKey !== 'string') {
        res.status(400).json({ error: 'apiKey is required and must be a string' });
        return;
      }

      const normalizedUrl = validateInstanceUrl(url, skipSslVerify);
      const validatedTimeout = validateTimeout(timeout);

      const client = createArrClient(
        type as ArrType,
        normalizedUrl,
        apiKey,
        validatedTimeout,
        skipSslVerify,
      );
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
          error: result.error,
        },
      });

      res.json(result);
    } catch (error) {
      if (error instanceof SecurityPolicyError) {
        res.status(400).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, 'Failed to test unsaved instance connection');
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Connection test failed',
      });
    }
  });

  // GET /api/v1/instances/:id/test — Test instance connection
  router.get('/:id/test', async (req: Request, res: Response) => {
    try {
      const id = Number.parseInt(req.params['id'] as string, 10);
      if (Number.isNaN(id)) {
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
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Connection test failed',
      });
    }
  });

  return router;
}
