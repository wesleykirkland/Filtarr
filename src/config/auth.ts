import { z } from 'zod';
import { getConfig } from './index.js';

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
  // Host header allowlist (FILTARR_ALLOWED_HOSTS). Unset = allow any Host.
  allowedHosts: z
    .array(z.object({ hostname: z.string(), port: z.string().optional() }))
    .optional(),
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

export interface AllowedHost {
  /** Lower-cased hostname (IPv6 literals keep their brackets, e.g. `[::1]`). */
  hostname: string;
  /** Port to match, or undefined to match any port. */
  port?: string;
}

/** Hosts that are always accepted, regardless of FILTARR_ALLOWED_HOSTS. */
export const IMPLICIT_ALLOWED_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]'] as const;

/** Split a Host header value (or allowlist entry) into a lower-cased hostname and optional port. */
export function splitHostPort(value: string): AllowedHost {
  const host = value.trim().toLowerCase();
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    if (end === -1) return { hostname: host };
    const rest = host.slice(end + 1);
    return {
      hostname: host.slice(0, end + 1),
      port: rest.startsWith(':') && rest.length > 1 ? rest.slice(1) : undefined,
    };
  }
  const colon = host.lastIndexOf(':');
  if (colon !== -1 && host.indexOf(':') === colon) {
    const port = host.slice(colon + 1);
    return { hostname: host.slice(0, colon), port: port || undefined };
  }
  return { hostname: host };
}

/**
 * Parse FILTARR_ALLOWED_HOSTS: a comma-separated list of hostnames, each with an optional port
 * (e.g. `filtarr.example.com, 192.168.1.10:9898`). Matching is case-insensitive. Empty/unset
 * returns undefined (all hosts allowed).
 */
export function parseAllowedHosts(raw: string | undefined): AllowedHost[] | undefined {
  const entries = (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(splitHostPort)
    .filter((entry) => entry.hostname.length > 0);
  return entries.length > 0 ? entries : undefined;
}

/**
 * Whether a request Host header is permitted by the allowlist. localhost, 127.0.0.1 and [::1]
 * are always allowed. An entry without a port matches the hostname on any port.
 */
export function isHostAllowed(hostHeader: string | undefined, allowed: AllowedHost[]): boolean {
  if (!hostHeader) return false;
  const { hostname, port } = splitHostPort(hostHeader);
  if ((IMPLICIT_ALLOWED_HOSTNAMES as readonly string[]).includes(hostname)) return true;
  return allowed.some(
    (entry) => entry.hostname === hostname && (entry.port === undefined || entry.port === port),
  );
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
  return getConfig().nodeEnv === 'production';
}

/**
 * Read session settings (FILTARR_SESSION_SECRET, FILTARR_SESSION_MAX_AGE,
 * FILTARR_SESSION_COOKIE_NAME) and validate them with FormsAuthConfigSchema. These are read in
 * every auth mode, because the mode can switch to forms at runtime without a restart.
 * Throws a descriptive error on invalid values so startup fails fast.
 */
export function loadSessionConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): z.infer<typeof FormsAuthConfigSchema> | undefined {
  const secret = env['FILTARR_SESSION_SECRET'];
  const maxAge = env['FILTARR_SESSION_MAX_AGE'];
  const cookieName = env['FILTARR_SESSION_COOKIE_NAME'];
  if (!secret && !maxAge && !cookieName) return undefined;

  const raw: Record<string, unknown> = {};
  if (secret) raw['sessionSecret'] = secret;
  if (maxAge) raw['sessionMaxAge'] = /^\d+$/.test(maxAge.trim()) ? Number(maxAge.trim()) : maxAge;
  if (cookieName) raw['cookieName'] = cookieName;

  const result = FormsAuthConfigSchema.safeParse(raw);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || 'session'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid session configuration (FILTARR_SESSION_SECRET / FILTARR_SESSION_MAX_AGE / FILTARR_SESSION_COOKIE_NAME):\n${errors}`,
    );
  }
  return result.data;
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

  // Session settings from env (validated; throws on e.g. a secret shorter than 32 chars)
  const forms = loadSessionConfigFromEnv(env);
  if (forms) {
    config.forms = forms;
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

  const allowedHosts = parseAllowedHosts(env['FILTARR_ALLOWED_HOSTS']);
  if (allowedHosts !== undefined) {
    config.allowedHosts = allowedHosts;
  }

  const cookieSecure = parseCookieSecure(env['FILTARR_COOKIE_SECURE']);
  if (cookieSecure !== undefined) {
    config.cookieSecure = cookieSecure;
  }

  return config;
}
