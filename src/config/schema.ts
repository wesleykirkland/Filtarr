import { z } from 'zod';

export const configSchema = z.object({
  port: z.coerce.number().int().min(1).max(65535).default(9898),
  host: z.string().default('0.0.0.0'),
  dataDir: z.string().default('./data'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  nodeEnv: z.enum(['development', 'production', 'test']).default('production'),
});

export type AppConfig = z.infer<typeof configSchema>;
