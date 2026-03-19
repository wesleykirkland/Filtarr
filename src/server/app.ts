import express from 'express';
import path from 'node:path';
import { createInstancesRouter } from './routes/instances.js';
import { createDirectoriesRoutes } from './routes/directories.js';
import { createFiltersRoutes } from './routes/filters.js';
import { createJobsRoutes } from './routes/jobs.js';
import { createEventsRoutes } from './routes/events.js';
import { createSetupRoutes, getStoredAuthMode } from './routes/setup.js';
import { createAuthRoutes } from './routes/auth.js';
import { createSettingsRoutes } from './routes/settings.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { applySecurityMiddleware, authRateLimiter } from './middleware/security.js';
import { publicSystemRoutes, protectedSystemRoutes } from './routes/system.js';
import { getDatabase } from '../db/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { loadAuthConfigFromEnv } from '../config/auth.js';
import type { AuthMode, AuthConfig } from '../config/auth.js';
import type { Database } from 'better-sqlite3';

/** Get the current auth configuration from database settings */
function getAuthConfig(db: Database): AuthConfig {
  const mode = getStoredAuthMode(db);
  const envConfig = loadAuthConfigFromEnv();
  const config: AuthConfig = {
    mode,
    apiKeyBcryptRounds: 12,
    rateLimitAuth: 5,
    rateLimitGeneral: 100,
    corsOrigin: envConfig.corsOrigin ?? 'same-origin',
  };

  // For forms mode, we need session config
  if (mode === 'forms') {
    config.forms = {
      sessionSecret: envConfig.forms?.sessionSecret,
      sessionMaxAge: envConfig.forms?.sessionMaxAge ?? 86400000,
      cookieName: envConfig.forms?.cookieName ?? 'filtarr.sid',
    };
  }

  if (mode === 'oidc' && envConfig.oidc) {
    config.oidc = envConfig.oidc;
  }

  // Basic mode doesn't need additional config — credentials are looked up from DB

  return config;
}

export function createApp(db: Database = getDatabase()): express.Application {
  const app = express();
  const authConfig = getAuthConfig(db);

  applySecurityMiddleware(app, authConfig);

  // Body parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // Auth-sensitive rate limiter (login, setup)
  const authLimiter = authRateLimiter(authConfig.rateLimitAuth);

  // Unauthenticated routes — setup and health check
  // SECURITY: These routes are intentionally unauthenticated
  app.use('/api/v1', publicSystemRoutes);
  app.use(
    '/api/v1/setup',
    authLimiter,
    createSetupRoutes(db, (authMode: AuthMode) => {
      // Runtime config update callback
      console.log(`Setup completed with auth mode: ${authMode}`);
    }),
  );

  // Create auth middleware (applies session, API key, basic auth as needed)
  const { authRouter, requireAuth } = createAuthMiddleware(db, authConfig);

  // Apply auth middleware to all /api/v1 routes (except setup and health which are already mounted)
  app.use('/api/v1', authRouter);

  // Auth routes (login, logout, session, API key management)
  // These are mounted AFTER auth middleware so they can use session
  app.use('/api/v1/auth', authLimiter, createAuthRoutes(db, authConfig));
  app.use('/api/v1', requireAuth, protectedSystemRoutes);

  // Protected routes - require authentication
  app.use('/api/v1/instances', requireAuth, createInstancesRouter(db));
  app.use('/api/v1/directories', requireAuth, createDirectoriesRoutes(db));
  app.use('/api/v1/filters', requireAuth, createFiltersRoutes(db));
  app.use('/api/v1/jobs', requireAuth, createJobsRoutes(db));
  app.use('/api/v1/events', requireAuth, createEventsRoutes(db));
  app.use(
    '/api/v1/settings',
    requireAuth,
    createSettingsRoutes(db, (authMode: AuthMode) => {
      console.log(`Auth mode changed to: ${authMode}`);
    }),
  );

  // Serve client static files (built by Vite into dist/client/)
  const clientDir = path.resolve(process.cwd(), 'dist', 'client');
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
