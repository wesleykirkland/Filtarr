import { Router, type Request, type Response, type NextFunction } from 'express';
import type Database from 'better-sqlite3';
import { listEvents } from '../../db/schemas/events.js';

export function createEventsRoutes(db: Database.Database): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response, next: NextFunction): void => {
    try {
      const limit = req.query['limit'] ? Number.parseInt(String(req.query['limit']), 10) : undefined;
      const type = typeof req.query['type'] === 'string' ? req.query['type'] : undefined;
      const source = typeof req.query['source'] === 'string' ? req.query['source'] : undefined;

      if (limit !== undefined && Number.isNaN(limit)) {
        res.status(400).json({ error: 'limit must be a number' });
        return;
      }

      res.json(listEvents(db, { limit, type, source }));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
