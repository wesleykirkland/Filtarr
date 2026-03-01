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
import { ArrClient } from '../../services/arr/client.js';
import { SonarrClient } from '../../services/arr/sonarr.js';
import { RadarrClient } from '../../services/arr/radarr.js';
import { LidarrClient } from '../../services/arr/lidarr.js';
import type { ArrType } from '../../services/arr/types.js';

const VALID_ARR_TYPES: ArrType[] = ['sonarr', 'radarr', 'lidarr'];

/**
 * Create a typed Arr client for the given instance type.
 */
function createArrClient(type: ArrType, url: string, apiKey: string, timeout?: number): ArrClient {
  const options = { baseUrl: url, apiKey, timeout };
  switch (type) {
    case 'sonarr': return new SonarrClient(options);
    case 'radarr': return new RadarrClient(options);
    case 'lidarr': return new LidarrClient(options);
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
    } catch (error) {
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
    } catch (error) {
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

      const instance = createInstance(db, { name, type, url, apiKey, timeout, enabled });
      res.status(201).json(instance);
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint')) {
        res.status(409).json({ error: 'An instance with this name and type already exists' });
        return;
      }
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
        try { new URL(body.url); } catch {
          res.status(400).json({ error: 'url must be a valid URL' });
          return;
        }
        input.url = body.url;
      }
      if (body.apiKey !== undefined) input.apiKey = body.apiKey;
      if (body.timeout !== undefined) input.timeout = body.timeout;
      if (body.enabled !== undefined) input.enabled = body.enabled;

      const instance = updateInstance(db, id, input);
      if (!instance) {
        res.status(404).json({ error: 'Instance not found' });
        return;
      }

      res.json(instance);
    } catch (error) {
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

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete instance' });
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

      const client = createArrClient(config.type, config.url, config.apiKey, config.timeout);
      const result = await client.testConnection();

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
