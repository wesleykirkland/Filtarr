import { loadConfig } from '../config/index.js';
import { getDatabase, closeDatabase } from '../db/index.js';
import { createApp } from './app.js';

function main(): void {
  const config = loadConfig();
  console.log(`Filtarr starting in ${config.nodeEnv} mode...`);

  // Initialize database (runs migrations on first start)
  getDatabase();
  console.log('Database initialized.');

  const app = createApp();

  const server = app.listen(config.port, config.host, () => {
    console.log(`Filtarr listening on http://${config.host}:${config.port}`);
    console.log(`Health check: http://localhost:${config.port}/api/v1/health`);
  });

  // Graceful shutdown
  const shutdown = (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down gracefully...`);
    server.close(() => {
      closeDatabase();
      console.log('Server closed.');
      process.exit(0);
    });

    // Force exit after 10 seconds
    setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();

