import express from 'express';
import path from 'node:path';
import { createInstancesRouter } from './routes/instances.js';
import { createDirectoriesRoutes } from './routes/directories.js';
import { createFiltersRoutes } from './routes/filters.js';
import { createJobsRoutes } from './routes/jobs.js';
import { createEventsRoutes } from './routes/events.js';
import { createSetupRoutes } from './routes/setup.js';
import { getAuthMode } from './lib/authMode.js';
import { createAuthRoutes } from './routes/auth.js';
import { createSettingsRoutes } from './routes/settings.js';

const BACKUP_IMPORT_PATH = '/api/v1/settings/backup/import';
import { createAuthMiddleware } from './middleware/auth.js';
import { applySecurityMiddleware } from './middleware/security.js';
import {
  noStoreApiResponses,
  rejectCrossSiteRequests,
  requireJsonBody,
  sensitiveActionLimiter,
  SENSITIVE_ACTION_PATHS,
} from './middleware/requestPolicy.js';
import { publicSystemRoutes, protectedSystemRoutes } from './routes/system.js';
import { getDatabase } from '../db/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { isHostAllowed, loadAuthConfigFromEnv } from '../config/auth.js';
import { logger } from './lib/logger.js';
import type { AuthMode, AuthConfig } from '../config/auth.js';
import type { Database } from 'better-sqlite3';

let warnedAllowedHostsUnset = false;

/** Get the current auth configuration from database settings */
function getAuthConfig(db: Database): AuthConfig {
  const mode = getAuthMode(db);
  const envConfig = loadAuthConfigFromEnv();
  const config: AuthConfig = {
    mode,
    apiKeyBcryptRounds: 12,
    rateLimitAuth: 5,
    rateLimitGeneral: 100,
    corsOrigin: envConfig.corsOrigin ?? 'same-origin',
    trustProxy: envConfig.trustProxy,
    cookieSecure: envConfig.cookieSecure,
    allowedHosts: envConfig.allowedHosts,
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

  // Honor X-Forwarded-* only when explicitly configured (FILTARR_TRUST_PROXY).
  // This drives req.ip (rate limiting) and req.secure (Secure session cookies behind TLS proxies).
  if (authConfig.trustProxy !== undefined) {
    app.set('trust proxy', authConfig.trustProxy);
  }

  // DNS-rebinding defense: reject requests whose Host header is not allowlisted.
  // Mounted before every other middleware/route.
  const { allowedHosts } = authConfig;
  if (allowedHosts) {
    app.use((req, res, next) => {
      if (isHostAllowed(req.headers.host, allowedHosts)) {
        next();
        return;
      }
      res.status(421).json({ error: 'Misdirected request: host not allowed' });
    });
  } else if (process.env['NODE_ENV'] === 'production' && !warnedAllowedHostsUnset) {
    warnedAllowedHostsUnset = true;
    logger.warn(
      'FILTARR_ALLOWED_HOSTS is not set; requests for any Host header are accepted. ' +
        'Set it to the hostname(s) you use to reach Filtarr to protect against DNS rebinding.',
    );
  }

  applySecurityMiddleware(app, authConfig);

  // Request policy: no caching of API responses, CSRF defenses (cross-site
  // rejection for ambient-credential requests, JSON-only bodies), and a strict
  // limiter on expensive/sensitive actions.
  app.use('/api', noStoreApiResponses());
  app.use('/api', rejectCrossSiteRequests(authConfig.corsOrigin));
  app.use('/api', requireJsonBody());
  app.post(SENSITIVE_ACTION_PATHS, sensitiveActionLimiter());

  // Body parsing. The backup import route installs its own JSON parser with a
  // larger limit (after authentication), so skip the default 100kb parser there.
  const defaultJsonParser = express.json();
  app.use((req, res, next) => {
    if (req.method === 'POST' && req.path === BACKUP_IMPORT_PATH) {
      next();
      return;
    }
    defaultJsonParser(req, res, next);
  });

  // Unauthenticated routes — setup and health check
  // SECURITY: These routes are intentionally unauthenticated
  app.use('/api/v1', publicSystemRoutes);
  // POST /setup/complete applies its own auth rate limiter; GET /setup/status is not throttled.
  app.use(
    '/api/v1/setup',
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
  // These are mounted AFTER auth middleware so they can use session.
  // The login endpoint applies its own rate limiter; session/API-key routes are not login-limited.
  app.use('/api/v1/auth', createAuthRoutes(db, authConfig));
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
