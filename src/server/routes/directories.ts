import { Router, type Request, type Response, type NextFunction } from 'express';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import {
  getAllDirectories,
  getDirectoryById,
  createDirectory,
  updateDirectory,
  deleteDirectory,
} from '../../db/schemas/directories.js';
import { recordActivityEvent } from '../lib/activity.js';
import { logger } from '../lib/logger.js';
import { reloadWatcher } from '../services/watcher.js';

const createDirectorySchema = z.object({
  path: z.string().min(1, 'Path is required'),
  recursive: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

const updateDirectorySchema = z.object({
  path: z.string().min(1).optional(),
  recursive: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

export function createDirectoriesRoutes(db: Database.Database): Router {
  const router = Router();

  // GET /api/v1/directories
  router.get('/', (_req: Request, res: Response, next: NextFunction): void => {
    try {
      const dirs = getAllDirectories(db);
      res.json(dirs);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/directories/:id
  router.get('/:id', (req: Request, res: Response, next: NextFunction): void => {
    try {
      const id = Number.parseInt((req.params['id'] as string) || '', 10);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: 'Invalid ID' });
        return;
      }
      const dir = getDirectoryById(db, id);
      if (!dir) {
        res.status(404).json({ error: 'Directory not found' });
        return;
      }
      res.json(dir);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/directories
  router.post('/', (req: Request, res: Response, next: NextFunction): void => {
    try {
      const data = createDirectorySchema.parse(req.body);

      // Simple validation: check if path is absolute
      if (!data.path.startsWith('/')) {
        res.status(400).json({ error: 'Directory path must be absolute (start with /)' });
        return;
      }

      const dir = createDirectory(db, data);
      logger.info({ dirId: dir.id, path: dir.path }, 'Directory created');
      recordActivityEvent(db, {
        type: 'created',
        source: 'directories',
        message: `Added watched directory ${dir.path}`,
        details: { directoryId: dir.id, path: dir.path, recursive: dir.recursive, enabled: dir.enabled },
      });
      reloadWatcher();
      res.status(201).json(dir);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.issues[0]?.message || 'Invalid input' });
      } else if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        res.status(409).json({ error: 'A directory with this path already exists' });
      } else {
        next(err);
      }
    }
  });

  // PUT /api/v1/directories/:id
  router.put('/:id', (req: Request, res: Response, next: NextFunction): void => {
    try {
      const id = Number.parseInt((req.params['id'] as string) || '', 10);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: 'Invalid ID' });
        return;
      }
      const data = updateDirectorySchema.parse(req.body);

      if (data.path !== undefined && !data.path.startsWith('/')) {
        res.status(400).json({ error: 'Directory path must be absolute (start with /)' });
        return;
      }

      const dir = updateDirectory(db, id, data);
      logger.info({ dirId: dir.id }, 'Directory updated');
      recordActivityEvent(db, {
        type: 'updated',
        source: 'directories',
        message: `Updated watched directory ${dir.path}`,
        details: {
          directoryId: dir.id,
          path: dir.path,
          recursive: dir.recursive,
          enabled: dir.enabled,
          changedFields: Object.keys(data),
        },
      });
      reloadWatcher();
      res.json(dir);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.issues[0]?.message || 'Invalid input' });
      } else if (err instanceof Error && err.message.includes('not found')) {
        res.status(404).json({ error: err.message });
      } else if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        res.status(409).json({ error: 'A directory with this path already exists' });
      } else {
        next(err);
      }
    }
  });

  // DELETE /api/v1/directories/:id
  router.delete('/:id', (req: Request, res: Response, next: NextFunction): void => {
    try {
      const id = Number.parseInt((req.params['id'] as string) || '', 10);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: 'Invalid ID' });
        return;
      }
      const current = getDirectoryById(db, id);
      const success = deleteDirectory(db, id);
      if (!success) {
        res.status(404).json({ error: 'Directory not found' });
        return;
      }
      logger.info({ dirId: id }, 'Directory deleted');
      recordActivityEvent(db, {
        type: 'deleted',
        source: 'directories',
        message: `Removed watched directory ${current?.path || `#${id}`}`,
        details: current
          ? { directoryId: current.id, path: current.path, recursive: current.recursive }
          : { directoryId: id },
      });
      reloadWatcher();
      res.json({ success: true, message: 'Directory deleted successfully' });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
