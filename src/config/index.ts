import dotenv from 'dotenv';
import { configSchema } from './schema.js';
import type { AppConfig } from './schema.js';

dotenv.config();

let _config: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (_config) return _config;

  const raw = {
    port: process.env['FILTARR_PORT'] ?? process.env['PORT'],
    host: process.env['FILTARR_HOST'],
    dataDir: process.env['FILTARR_DATA_DIR'],
    logLevel: process.env['FILTARR_LOG_LEVEL'],
    nodeEnv: process.env['NODE_ENV'],
  };

  // Strip undefined values so zod defaults apply
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined));

  const result = configSchema.safeParse(cleaned);
  if (!result.success) {
    const errors = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${errors}`);
  }

  _config = result.data;
  return _config;
}

export function getConfig(): AppConfig {
  if (!_config) return loadConfig();
  return _config;
}

export function resetConfigCache(): void {
  _config = null;
}

export { type AppConfig } from './schema.js';
