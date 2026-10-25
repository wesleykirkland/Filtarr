import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AuthConfigSchema,
  FormsAuthConfigSchema,
  OidcAuthConfigSchema,
  loadAuthConfigFromEnv,
  isHostAllowed,
  parseAllowedHosts,
  parseCookieSecure,
  parseTrustProxy,
} from '../../src/config/auth.js';

describe('auth config helpers', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('applies schema defaults for auth configuration', () => {
    expect(AuthConfigSchema.parse({})).toEqual({
      mode: 'none',
      apiKeyBcryptRounds: 12,
      rateLimitAuth: 5,
      rateLimitGeneral: 100,
      corsOrigin: 'same-origin',
    });
  });

  it('validates forms and oidc schemas', () => {
    expect(FormsAuthConfigSchema.parse({})).toEqual({
      sessionMaxAge: 86_400_000,
      cookieName: 'filtarr.sid',
    });

    expect(OidcAuthConfigSchema.parse({
      issuerUrl: 'https://issuer.example.com',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    })).toMatchObject({
      callbackUrl: 'http://localhost:9898/api/v1/auth/oidc/callback',
      scopes: ['openid', 'profile', 'email'],
    });
  });

  it('loads auth config overrides from environment variables', () => {
    process.env['FILTARR_AUTH_MODE'] = 'forms';
    process.env['FILTARR_AUTH_USERNAME'] = 'admin';
    process.env['FILTARR_AUTH_PASSWORD'] = 'supersecret';
    process.env['FILTARR_SESSION_SECRET'] = 'a'.repeat(32);
    process.env['FILTARR_SESSION_MAX_AGE'] = '9000';
    process.env['FILTARR_SESSION_COOKIE_NAME'] = 'custom.sid';
    process.env['FILTARR_OIDC_ISSUER'] = 'https://issuer.example.com';
    process.env['FILTARR_OIDC_CLIENT_ID'] = 'client-id';
    process.env['FILTARR_OIDC_CLIENT_SECRET'] = 'client-secret';
    process.env['FILTARR_OIDC_CALLBACK_URL'] = 'https://app.example.com/callback';
    process.env['FILTARR_OIDC_SCOPES'] = 'openid,profile,groups';
    process.env['FILTARR_CORS_ORIGIN'] = 'https://app.example.com';

    // Auth mode and credentials live in the database, never in env.
    expect(loadAuthConfigFromEnv()).toEqual({
      forms: {
        sessionSecret: 'a'.repeat(32),
        sessionMaxAge: 9000,
        cookieName: 'custom.sid',
      },
      oidc: {
        issuerUrl: 'https://issuer.example.com',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        callbackUrl: 'https://app.example.com/callback',
        scopes: ['openid', 'profile', 'groups'],
      },
      corsOrigin: 'https://app.example.com',
    });
  });

  it('returns an empty override object when auth env vars are absent', () => {
    expect(loadAuthConfigFromEnv()).toEqual({});
  });

  it('parses FILTARR_TRUST_PROXY as boolean, hop count, or address list', () => {
    expect(parseTrustProxy(undefined)).toBeUndefined();
    expect(parseTrustProxy('  ')).toBeUndefined();
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('FALSE')).toBe(false);
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('0')).toBe(0);
    expect(parseTrustProxy('loopback, 10.0.0.0/8 ,')).toBe('loopback,10.0.0.0/8');
  });

  it('parses FILTARR_COOKIE_SECURE and rejects unknown values', () => {
    expect(parseCookieSecure(undefined)).toBeUndefined();
    expect(parseCookieSecure('true')).toBe(true);
    expect(parseCookieSecure('false')).toBe(false);
    expect(parseCookieSecure('Auto')).toBe('auto');
    expect(() => parseCookieSecure('maybe')).toThrow('FILTARR_COOKIE_SECURE');
  });

  it('loads trust proxy and cookie secure overrides from the environment', () => {
    process.env['FILTARR_TRUST_PROXY'] = '2';
    process.env['FILTARR_COOKIE_SECURE'] = 'false';

    expect(loadAuthConfigFromEnv()).toEqual({ trustProxy: 2, cookieSecure: false });
  });

  it('rejects a session secret shorter than 32 characters and invalid max ages', () => {
    process.env['FILTARR_SESSION_SECRET'] = 'too-short';
    expect(() => loadAuthConfigFromEnv()).toThrow(/FILTARR_SESSION_SECRET[\s\S]*at least 32 characters/);

    process.env['FILTARR_SESSION_SECRET'] = 'a'.repeat(32);
    process.env['FILTARR_SESSION_MAX_AGE'] = 'soon';
    expect(() => loadAuthConfigFromEnv()).toThrow('Invalid session configuration');
  });

  it('reads session max age and cookie name even without a session secret', () => {
    process.env['FILTARR_SESSION_MAX_AGE'] = '1000';
    process.env['FILTARR_SESSION_COOKIE_NAME'] = 'x.sid';
    expect(loadAuthConfigFromEnv()).toEqual({ forms: { sessionMaxAge: 1000, cookieName: 'x.sid' } });
  });

  it('ignores auth mode and credential env vars', () => {
    process.env['FILTARR_AUTH_MODE'] = 'ldap';
    process.env['FILTARR_AUTH_USERNAME'] = 'admin';
    process.env['FILTARR_AUTH_PASSWORD'] = 'supersecret';

    expect(loadAuthConfigFromEnv()).toEqual({});
  });

  it('parses FILTARR_ALLOWED_HOSTS entries with optional ports, case-insensitively', () => {
    expect(parseAllowedHosts(undefined)).toBeUndefined();
    expect(parseAllowedHosts('  , ')).toBeUndefined();
    expect(parseAllowedHosts('Filtarr.Example.com, 192.168.1.10:9898, [fd00::1]:9898')).toEqual([
      { hostname: 'filtarr.example.com' },
      { hostname: '192.168.1.10', port: '9898' },
      { hostname: '[fd00::1]', port: '9898' },
    ]);

    process.env['FILTARR_ALLOWED_HOSTS'] = 'filtarr.lan';
    expect(loadAuthConfigFromEnv().allowedHosts).toEqual([{ hostname: 'filtarr.lan' }]);
    delete process.env['FILTARR_ALLOWED_HOSTS'];
    expect(loadAuthConfigFromEnv().allowedHosts).toBeUndefined();
  });

  it('matches Host headers against the allowlist and always allows loopback names', () => {
    const allowed = parseAllowedHosts('filtarr.example.com, nas.lan:9898') ?? [];

    expect(isHostAllowed('filtarr.example.com', allowed)).toBe(true);
    expect(isHostAllowed('FILTARR.example.com:443', allowed)).toBe(true);
    expect(isHostAllowed('nas.lan:9898', allowed)).toBe(true);
    expect(isHostAllowed('nas.lan:8080', allowed)).toBe(false);
    expect(isHostAllowed('nas.lan', allowed)).toBe(false);
    expect(isHostAllowed('evil.example.com', allowed)).toBe(false);
    expect(isHostAllowed(undefined, allowed)).toBe(false);

    expect(isHostAllowed('localhost:9898', allowed)).toBe(true);
    expect(isHostAllowed('127.0.0.1', allowed)).toBe(true);
    expect(isHostAllowed('[::1]:9898', allowed)).toBe(true);
  });
});
