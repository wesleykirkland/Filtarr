import { loadConfig } from '../config/index.js';
import { logger } from './lib/logger.js';
import { getDatabase, closeDatabase } from '../db/index.js';
import { createApp } from './app.js';
import { startInstanceValidator, stopInstanceValidator } from './cron/instanceValidator.js';
import { startSettingsBackupScheduler, stopSettingsBackupScheduler } from './cron/settingsBackup.js';
import { initWatcher, stopWatcher } from './services/watcher.js';
import { initScheduler, stopScheduler } from './cron/scheduler.js';

function main(): void {
  const config = loadConfig();
  logger.info(`Filtarr starting in ${config.nodeEnv} mode...`);

  // Initialize database (runs migrations on first start)
  const db = getDatabase();
  logger.info('Database initialized.');

  // Start background services
  startInstanceValidator(db);
  startSettingsBackupScheduler(db);
  initWatcher(db);
  initScheduler(db);

  const app = createApp();

  const server = app.listen(config.port, config.host, () => {
    logger.info(`Filtarr listening on http://${config.host}:${config.port}`);
    logger.info(`Health check: http://localhost:${config.port}/api/v1/health`);
  });

  // Graceful shutdown
  const shutdown = (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    stopInstanceValidator();
    stopSettingsBackupScheduler();
    stopWatcher();
    stopScheduler();
    server.close(() => {
      closeDatabase();
      logger.info('Server closed.');
      process.exit(0);
    });

    // Force exit after 10 seconds
    setTimeout(() => {
      logger.fatal('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
