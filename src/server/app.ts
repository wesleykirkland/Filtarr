import express from 'express';
import path from 'node:path';
import systemRoutes from './routes/system.js';
import { createInstancesRouter } from './routes/instances.js';
import { createDirectoriesRoutes } from './routes/directories.js';
import { createFiltersRoutes } from './routes/filters.js';
import { createJobsRoutes } from './routes/jobs.js';
import { createSetupRoutes, getStoredAuthMode } from './routes/setup.js';
import { createAuthRoutes } from './routes/auth.js';
import { createSettingsRoutes } from './routes/settings.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { getDatabase } from '../db/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import {
  DEFAULT_OIDC_CALLBACK_URL,
  DEFAULT_OIDC_SCOPES,
  loadAuthConfigFromEnv,
  type AuthMode,
  type AuthConfig,
} from '../config/auth.js';
import type { Database } from 'better-sqlite3';

/** Get the current auth configuration from database settings */
function getAuthConfig(db: Database): AuthConfig {
  const envConfig = loadAuthConfigFromEnv();
  const mode = getStoredAuthMode(db);
  const config: AuthConfig = {
    mode,
    apiKeyBcryptRounds: 12,
    rateLimitAuth: 5,
    rateLimitGeneral: 100,
    corsOrigin: 'same-origin',
  };

  // For forms mode, we need session config
  if (mode === 'forms') {
    config.forms = {
      sessionSecret: envConfig.forms?.sessionSecret,
      sessionMaxAge: 86400000,
      cookieName: 'filtarr.sid',
    };
  }

  if (mode === 'oidc') {
    const getSetting = (key: string) =>
      db.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?').get(key)
        ?.value;
    const rawScopes = getSetting('oidc_scopes') ?? envConfig.oidc?.scopes?.join(',');

    config.oidc = {
      issuerUrl: getSetting('oidc_issuer_url') ?? envConfig.oidc?.issuerUrl ?? '',
      clientId: getSetting('oidc_client_id') ?? envConfig.oidc?.clientId ?? '',
      clientSecret: getSetting('oidc_client_secret') ?? envConfig.oidc?.clientSecret ?? '',
      callbackUrl:
        getSetting('oidc_callback_url') ??
        envConfig.oidc?.callbackUrl ??
        DEFAULT_OIDC_CALLBACK_URL,
      scopes: rawScopes
        ? rawScopes.split(',').map((scope) => scope.trim()).filter(Boolean)
        : [...DEFAULT_OIDC_SCOPES],
    };
  }

  // Basic mode doesn't need additional config — credentials are looked up from DB

  return config;
}

export function createApp(): express.Application {
  const app = express();
  const db = getDatabase();

  // Body parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // Unauthenticated routes — setup and health check
  // SECURITY: These routes are intentionally unauthenticated
  app.use('/api/v1', systemRoutes);
  app.use(
    '/api/v1/setup',
    createSetupRoutes(db, (authMode: AuthMode) => {
      // Runtime config update callback
      console.log(`Setup completed with auth mode: ${authMode}`);
    }),
  );

  // Get current auth configuration from database
  const authConfig = getAuthConfig(db);

  // Create auth middleware (applies session, API key, basic auth as needed)
  const { authRouter, requireAuth } = createAuthMiddleware(db, authConfig);

  // Apply auth middleware to all /api/v1 routes (except setup and health which are already mounted)
  app.use('/api/v1', authRouter);

  // Auth routes (login, logout, session, API key management)
  // These are mounted AFTER auth middleware so they can use session
  app.use('/api/v1/auth', createAuthRoutes(db, authConfig));

  // Protected routes - require authentication
  app.use('/api/v1/instances', requireAuth, createInstancesRouter(db));
  app.use('/api/v1/directories', requireAuth, createDirectoriesRoutes(db));
  app.use('/api/v1/filters', requireAuth, createFiltersRoutes(db));
  app.use('/api/v1/jobs', requireAuth, createJobsRoutes(db));
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
