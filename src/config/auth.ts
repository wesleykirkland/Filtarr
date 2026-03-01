import { z } from 'zod';

export const AuthMode = z.enum(['none', 'basic', 'forms', 'oidc']);
export type AuthMode = z.infer<typeof AuthMode>;

export const BasicAuthConfigSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const FormsAuthConfigSchema = z.object({
  sessionSecret: z.string().min(32, 'Session secret must be at least 32 characters').optional(),
  sessionMaxAge: z.number().int().positive().default(86400000), // 24 hours in ms
  cookieName: z.string().default('filtarr.sid'),
});

export const OidcAuthConfigSchema = z.object({
  issuerUrl: z.string().url('OIDC issuer must be a valid URL'),
  clientId: z.string().min(1, 'OIDC client ID is required'),
  clientSecret: z.string().min(1, 'OIDC client secret is required'),
  callbackUrl: z.string().url().default('http://localhost:9898/api/v1/auth/oidc/callback'),
  scopes: z.array(z.string()).default(['openid', 'profile', 'email']),
});

export const AuthConfigSchema = z.object({
  mode: AuthMode.default('none'),
  basic: BasicAuthConfigSchema.optional(),
  forms: FormsAuthConfigSchema.optional(),
  oidc: OidcAuthConfigSchema.optional(),
  apiKeyBcryptRounds: z.number().int().min(10).max(14).default(12),
  rateLimitAuth: z.number().int().positive().default(5),       // attempts per minute on auth endpoints
  rateLimitGeneral: z.number().int().positive().default(100),   // requests per minute general API
  corsOrigin: z.union([z.string(), z.array(z.string())]).default('same-origin'),
});

export type AuthConfig = z.infer<typeof AuthConfigSchema>;

/**
 * Load auth config from environment variables and/or config file values.
 */
export function loadAuthConfigFromEnv(): Partial<AuthConfig> {
  const config: Partial<AuthConfig> = {};

  const env = process.env;
  const mode = env['FILTARR_AUTH_MODE'];
  if (mode) {
    config.mode = AuthMode.parse(mode);
  }

  // Basic auth from env
  if (env['FILTARR_AUTH_USERNAME'] && env['FILTARR_AUTH_PASSWORD']) {
    config.basic = {
      username: env['FILTARR_AUTH_USERNAME'],
      password: env['FILTARR_AUTH_PASSWORD'],
    };
  }

  // Forms auth from env
  if (env['FILTARR_SESSION_SECRET']) {
    config.forms = {
      sessionSecret: env['FILTARR_SESSION_SECRET'],
      sessionMaxAge: parseInt(env['FILTARR_SESSION_MAX_AGE'] || '86400000', 10),
      cookieName: env['FILTARR_SESSION_COOKIE_NAME'] || 'filtarr.sid',
    };
  }

  // OIDC from env
  if (env['FILTARR_OIDC_ISSUER']) {
    config.oidc = {
      issuerUrl: env['FILTARR_OIDC_ISSUER'],
      clientId: env['FILTARR_OIDC_CLIENT_ID'] || '',
      clientSecret: env['FILTARR_OIDC_CLIENT_SECRET'] || '',
      callbackUrl: env['FILTARR_OIDC_CALLBACK_URL'] || 'http://localhost:9898/api/v1/auth/oidc/callback',
      scopes: (env['FILTARR_OIDC_SCOPES'] || 'openid,profile,email').split(','),
    };
  }

  // CORS
  if (env['FILTARR_CORS_ORIGIN']) {
    config.corsOrigin = env['FILTARR_CORS_ORIGIN'];
  }

  return config;
}

