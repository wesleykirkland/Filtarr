import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import systemRoutes from './routes/system.js';
import { createInstancesRouter } from './routes/instances.js';
import { getDatabase } from '../db/index.js';
import { errorHandler } from './middleware/errorHandler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(): express.Application {
  const app = express();

  // Body parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // API routes — mounted at /api/v1
  app.use('/api/v1', systemRoutes);
  app.use('/api/v1/instances', createInstancesRouter(getDatabase()));

  // Serve client static files in production
  const clientDir = path.resolve(__dirname, '../client');
  app.use(express.static(clientDir));

  // SPA fallback — serve index.html for non-API routes
  app.get('{*path}', (_req, res, next) => {
    if (_req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(clientDir, 'index.html'));
  });

  // Global error handler (must be last)
  app.use(errorHandler);

  return app;
}

