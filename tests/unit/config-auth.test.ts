import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AuthConfigSchema,
  BasicAuthConfigSchema,
  FormsAuthConfigSchema,
  OidcAuthConfigSchema,
  loadAuthConfigFromEnv,
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

  it('validates basic, forms, and oidc schemas', () => {
    expect(() => BasicAuthConfigSchema.parse({ username: 'admin', password: 'short' })).toThrow(
      'Password must be at least 8 characters',
    );

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

    expect(loadAuthConfigFromEnv()).toEqual({
      mode: 'forms',
      basic: {
        username: 'admin',
        password: 'supersecret',
      },
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

  it('throws when an invalid auth mode is provided in the environment', () => {
    process.env['FILTARR_AUTH_MODE'] = 'ldap';

    expect(() => loadAuthConfigFromEnv()).toThrow();
  });
});