import pino from 'pino';

const isDev = process.env['NODE_ENV'] !== 'production';

/**
 * Resolve the log level from the environment.
 *
 * FILTARR_LOG_LEVEL is the documented variable (and what config.logLevel
 * validates); LOG_LEVEL is still honored for backwards compatibility. Read the
 * env directly instead of via getConfig() so importing the logger never throws
 * on an unrelated invalid config value and never freezes the config cache.
 */
export function resolveLogLevel(env: NodeJS.ProcessEnv = process.env): string {
  const requested = (env['FILTARR_LOG_LEVEL'] || env['LOG_LEVEL'] || '').trim().toLowerCase();
  return requested && requested in pino.levels.values ? requested : 'info';
}

export const logger = pino({
  level: resolveLogLevel(),
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});
