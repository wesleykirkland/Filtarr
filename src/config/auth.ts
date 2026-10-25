import { z } from 'zod';

export const AuthMode = z.enum(['none', 'basic', 'forms', 'oidc']);
export type AuthMode = z.infer<typeof AuthMode>;

export const DEFAULT_OIDC_CALLBACK_URL = 'http://localhost:9898/api/v1/auth/oidc/callback';
export const DEFAULT_OIDC_SCOPES = ['openid', 'profile', 'email'] as const;

export const FormsAuthConfigSchema = z.object({
  sessionSecret: z.string().min(32, 'Session secret must be at least 32 characters').optional(),
  sessionMaxAge: z.number().int().positive().default(86400000), // 24 hours in ms
  cookieName: z.string().default('filtarr.sid'),
});

export const OidcAuthConfigSchema = z.object({
  issuerUrl: z.string().url('OIDC issuer must be a valid URL'),
  clientId: z.string().min(1, 'OIDC client ID is required'),
  clientSecret: z.string().min(1, 'OIDC client secret is required'),
  callbackUrl: z.string().url().default(DEFAULT_OIDC_CALLBACK_URL),
  scopes: z.array(z.string()).default([...DEFAULT_OIDC_SCOPES]),
});

export type OidcAuthConfig = z.infer<typeof OidcAuthConfigSchema>;

export const AuthConfigSchema = z.object({
  mode: AuthMode.default('none'),
  forms: FormsAuthConfigSchema.optional(),
  oidc: OidcAuthConfigSchema.optional(),
  apiKeyBcryptRounds: z.number().int().min(10).max(14).default(12),
  rateLimitAuth: z.number().int().positive().default(5), // attempts per minute on auth endpoints
  rateLimitGeneral: z.number().int().positive().default(100), // requests per minute general API
  corsOrigin: z.union([z.string(), z.array(z.string())]).default('same-origin'),
  // Express 'trust proxy' setting (FILTARR_TRUST_PROXY). Unset/false = do not trust X-Forwarded-*.
  trustProxy: z.union([z.boolean(), z.number().int().nonnegative(), z.string()]).optional(),
  // Session cookie Secure flag (FILTARR_COOKIE_SECURE). Unset = secure only when NODE_ENV=production.
  cookieSecure: z.union([z.boolean(), z.literal('auto')]).optional(),
});

export type AuthConfig = z.infer<typeof AuthConfigSchema>;

export type TrustProxySetting = boolean | number | string;

/**
 * Parse FILTARR_TRUST_PROXY into a value suitable for `app.set('trust proxy', value)`.
 * Accepts `true`/`false`, a non-negative integer hop count, or a comma-separated list of
 * trusted addresses/subnets (e.g. `loopback, 10.0.0.0/8`). Empty/unset returns undefined.
 */
export function parseTrustProxy(raw: string | undefined): TrustProxySetting | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  const lower = value.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  if (/^\d+$/.test(value)) return Number.parseInt(value, 10);
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join(',');
}

/**
 * Parse FILTARR_COOKIE_SECURE. Accepts `true`, `false`, or `auto` (Secure only when the
 * request arrived over HTTPS, as determined by Express/trust proxy). Empty/unset returns undefined.
 */
export function parseCookieSecure(raw: string | undefined): boolean | 'auto' | undefined {
  const value = raw?.trim().toLowerCase();
  if (!value) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'auto') return 'auto';
  throw new Error(`Invalid FILTARR_COOKIE_SECURE value "${raw}". Expected true, false, or auto.`);
}

/** Default Secure flag for the session cookie when FILTARR_COOKIE_SECURE is not set. */
export function defaultCookieSecure(): boolean {
  return process.env['NODE_ENV'] === 'production';
}

/**
 * Load auth-related overrides from environment variables.
 *
 * The auth mode and user credentials are deliberately NOT read from the
 * environment: they are chosen in the setup wizard / settings UI and stored in
 * the database (credentials as bcrypt hashes). Only session, OIDC and CORS
 * settings can come from env.
 */
export function loadAuthConfigFromEnv(): Partial<AuthConfig> {
  const config: Partial<AuthConfig> = {};

  const env = process.env;

  // Forms auth from env
  if (env['FILTARR_SESSION_SECRET']) {
    config.forms = {
      sessionSecret: env['FILTARR_SESSION_SECRET'],
      sessionMaxAge: Number.parseInt(env['FILTARR_SESSION_MAX_AGE'] || '86400000', 10),
      cookieName: env['FILTARR_SESSION_COOKIE_NAME'] || 'filtarr.sid',
    };
  }

  // OIDC from env
  if (env['FILTARR_OIDC_ISSUER']) {
    config.oidc = {
      issuerUrl: env['FILTARR_OIDC_ISSUER'],
      clientId: env['FILTARR_OIDC_CLIENT_ID'] || '',
      clientSecret: env['FILTARR_OIDC_CLIENT_SECRET'] || '',
      callbackUrl: env['FILTARR_OIDC_CALLBACK_URL'] || DEFAULT_OIDC_CALLBACK_URL,
      scopes: (env['FILTARR_OIDC_SCOPES'] || DEFAULT_OIDC_SCOPES.join(',')).split(','),
    };
  }

  // CORS
  if (env['FILTARR_CORS_ORIGIN']) {
    config.corsOrigin = env['FILTARR_CORS_ORIGIN'];
  }

  // Reverse proxy / cookie transport
  const trustProxy = parseTrustProxy(env['FILTARR_TRUST_PROXY']);
  if (trustProxy !== undefined) {
    config.trustProxy = trustProxy;
  }

  const cookieSecure = parseCookieSecure(env['FILTARR_COOKIE_SECURE']);
  if (cookieSecure !== undefined) {
    config.cookieSecure = cookieSecure;
  }

  return config;
}
