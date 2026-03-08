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
import type { ArrType } from '../../services/arr/types.js';
import { logger } from '../lib/logger.js';

const VALID_ARR_TYPES: ArrType[] = ['sonarr', 'radarr', 'lidarr'];

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
      const id = parseInt(req.params['id'] as string, 10);
      if (isNaN(id)) {
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

      // Validate URL format
      try {
        new URL(url);
      } catch {
        res.status(400).json({ error: 'url must be a valid URL' });
        return;
      }

      const instance = createInstance(db, {
        name,
        type,
        url,
        apiKey,
        timeout,
        enabled,
        skipSslVerify: req.body.skipSslVerify,
        remotePath: req.body.remotePath,
        localPath: req.body.localPath,
      });
      logger.info({ instanceId: instance.id }, 'Created new Arr instance');
      res.status(201).json(instance);
    } catch (err: unknown) {
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
      const id = parseInt(req.params['id'] as string, 10);
      if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid instance ID' });
        return;
      }

      const input: UpdateInstanceInput = {};
      const body = req.body;

      if (body.name !== undefined) input.name = body.name;
      if (body.type !== undefined) {
        if (!VALID_ARR_TYPES.includes(body.type)) {
          res.status(400).json({ error: `type must be one of: ${VALID_ARR_TYPES.join(', ')}` });
          return;
        }
        input.type = body.type;
      }
      if (body.url !== undefined) {
        try {
          new URL(body.url);
        } catch {
          res.status(400).json({ error: 'url must be a valid URL' });
          return;
        }
        input.url = body.url;
      }
      if (body.apiKey !== undefined) input.apiKey = body.apiKey;
      if (body.timeout !== undefined) input.timeout = body.timeout;
      if (body.enabled !== undefined) input.enabled = body.enabled;
      if (body.skipSslVerify !== undefined) input.skipSslVerify = body.skipSslVerify;
      if (body.remotePath !== undefined) input.remotePath = body.remotePath;
      if (body.localPath !== undefined) input.localPath = body.localPath;

      const instance = updateInstance(db, id, input);
      if (!instance) {
        res.status(404).json({ error: 'Instance not found' });
        return;
      }

      logger.info({ instanceId: instance.id }, 'Updated Arr instance');
      res.json(instance);
    } catch (err) {
      logger.error({ err, id: req.params['id'] }, 'Failed to update instance');
      res.status(500).json({ error: 'Failed to update instance' });
    }
  });

  // DELETE /api/v1/instances/:id — Delete instance
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params['id'] as string, 10);
      if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid instance ID' });
        return;
      }

      const deleted = deleteInstance(db, id);
      if (!deleted) {
        res.status(404).json({ error: 'Instance not found' });
        return;
      }

      logger.info({ instanceId: id }, 'Deleted Arr instance');
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

      // Validate URL format
      try {
        new URL(url);
      } catch {
        res.status(400).json({ error: 'url must be a valid URL' });
        return;
      }

      const client = createArrClient(type as ArrType, url, apiKey, timeout, skipSslVerify);
      const result = await client.testConnection();

      res.json(result);
    } catch (error) {
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
      const id = parseInt(req.params['id'] as string, 10);
      if (isNaN(id)) {
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

      if (!result.success) {
        logger.warn({ instanceId: id, error: result.error }, 'Arr instance connection test failed');
      }

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
