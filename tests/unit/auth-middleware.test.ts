import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const box: any = {};
  box.apiKeyHandle = vi.fn((_req, _res, next) => next());
  box.sessionHandle = vi.fn((_req, _res, next) => next());
  box.passportInitializeHandle = vi.fn((_req, _res, next) => next());
  box.passportSessionHandle = vi.fn((_req, _res, next) => next());
  box.apiKeyMiddleware = vi.fn(() => box.apiKeyHandle);
  box.sessionFactory = vi.fn(() => box.sessionHandle);
  box.passportUse = vi.fn();
  box.passportInitialize = vi.fn(() => box.passportInitializeHandle);
  box.passportSession = vi.fn(() => box.passportSessionHandle);
  box.passportSerializeUser = vi.fn((callback) => {
    box.serializeUser = callback;
  });
  box.passportDeserializeUser = vi.fn((callback) => {
    box.deserializeUser = callback;
  });
  box.LocalStrategy = vi.fn(function (this: unknown, verify) {
    box.localVerify = verify;
  });
  box.bcryptCompare = vi.fn();
  box.existsSync = vi.fn();
  box.mkdirSync = vi.fn();
  box.readFileSync = vi.fn();
  box.writeFileSync = vi.fn();
  box.randomBytes = vi.fn(() => Buffer.alloc(48, 7));
  box.getConfig = vi.fn(() => ({ dataDir: '/tmp/filtarr-data' }));
  box.localVerify = undefined;
  box.serializeUser = undefined;
  box.deserializeUser = undefined;
  return box;
});

vi.mock('../../src/server/middleware/apiKey.js', () => ({ apiKeyMiddleware: state.apiKeyMiddleware }));
vi.mock('express-session', () => ({ default: state.sessionFactory }));
vi.mock('passport', () => ({
  default: {
    use: state.passportUse,
    initialize: state.passportInitialize,
    session: state.passportSession,
    serializeUser: state.passportSerializeUser,
    deserializeUser: state.passportDeserializeUser,
  },
}));
vi.mock('passport-local', () => ({ Strategy: state.LocalStrategy }));
vi.mock('bcrypt', () => ({ default: { compare: state.bcryptCompare } }));
vi.mock('node:fs', () => ({
  existsSync: state.existsSync,
  mkdirSync: state.mkdirSync,
  readFileSync: state.readFileSync,
  writeFileSync: state.writeFileSync,
}));
vi.mock('node:crypto', () => ({ default: { randomBytes: state.randomBytes } }));
vi.mock('../../src/config/index.js', () => ({ getConfig: state.getConfig }));

import { createAuthMiddleware, getOrCreateSessionSecret } from '../../src/server/middleware/auth.js';

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'forms',
    apiKeyBcryptRounds: 12,
    rateLimitAuth: 5,
    rateLimitGeneral: 100,
    corsOrigin: 'same-origin',
    ...overrides,
  } as any;
}

function makeDb(options: Record<string, any> = {}) {
  const failedUpdate = { run: vi.fn() };
  const resetUpdate = { run: vi.fn() };
  const db = {
    prepare: vi.fn((sql: string) => {
      if (sql.includes("SELECT value FROM settings")) {
        if (options.authModeThrows) throw new Error('settings unavailable');
        return { get: vi.fn(() => (options.authMode === undefined ? undefined : { value: options.authMode })) };
      }
      if (sql.includes('SELECT username, password_hash FROM users')) {
        if (options.basicLookupThrows) throw new Error('basic lookup failed');
        return { get: vi.fn(() => options.basicUser) };
      }
      if (sql.includes('SELECT * FROM users WHERE username = ?')) {
        if (options.strategyLookupThrows) throw new Error('strategy lookup failed');
        return { get: vi.fn(() => options.strategyUser) };
      }
      if (sql.includes("UPDATE users SET failed_attempts = 0")) return resetUpdate;
      if (sql.includes("UPDATE users SET failed_attempts = ?")) return failedUpdate;
      if (sql.includes('SELECT * FROM users WHERE id = ?')) {
        return { get: vi.fn(() => options.deserializeUser) };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }),
  };
  return { db: db as any, failedUpdate, resetUpdate };
}

function makeResponse() {
  const res: any = {
    setHeader: vi.fn(),
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

function getHandles(db: any, config = makeConfig({ forms: { sessionSecret: 'x'.repeat(32) } })) {
  const { authRouter, requireAuth } = createAuthMiddleware(db, config);
  const handles = (authRouter as any).stack.map((layer: any) => layer.handle);
  return { requireAuth, basicAuth: handles[1] };
}

describe('auth middleware helpers', () => {
  beforeEach(() => {
    [
      state.apiKeyHandle,
      state.sessionHandle,
      state.passportInitializeHandle,
      state.passportSessionHandle,
      state.apiKeyMiddleware,
      state.sessionFactory,
      state.passportUse,
      state.passportInitialize,
      state.passportSession,
      state.passportSerializeUser,
      state.passportDeserializeUser,
      state.LocalStrategy,
      state.bcryptCompare,
      state.existsSync,
      state.mkdirSync,
      state.readFileSync,
      state.writeFileSync,
      state.randomBytes,
      state.getConfig,
    ].forEach((mock) => mock.mockReset());
    state.apiKeyMiddleware.mockImplementation(() => state.apiKeyHandle);
    state.sessionFactory.mockImplementation(() => state.sessionHandle);
    state.passportInitialize.mockImplementation(() => state.passportInitializeHandle);
    state.passportSession.mockImplementation(() => state.passportSessionHandle);
    state.passportSerializeUser.mockImplementation((callback) => {
      state.serializeUser = callback;
    });
    state.passportDeserializeUser.mockImplementation((callback) => {
      state.deserializeUser = callback;
    });
    state.LocalStrategy.mockImplementation(function (this: unknown, verify) {
      state.localVerify = verify;
    });
    state.randomBytes.mockReturnValue(Buffer.alloc(48, 7));
    state.getConfig.mockReturnValue({ dataDir: '/tmp/filtarr-data' });
    state.localVerify = undefined;
    state.serializeUser = undefined;
    state.deserializeUser = undefined;
    delete process.env['NODE_ENV'];
    vi.useRealTimers();
  });

  afterEach(() => {
    delete process.env['NODE_ENV'];
    vi.useRealTimers();
  });

  it('enforces requireAuth across auth modes and falls back to none when settings lookup fails', () => {
    const noneReq = {} as any;
    const noneNext = vi.fn();
    getHandles(makeDb({ authModeThrows: true }).db).requireAuth(noneReq, makeResponse(), noneNext);
    expect(noneNext).toHaveBeenCalledTimes(1);

    const apiNext = vi.fn();
    getHandles(makeDb({ authMode: 'forms' }).db).requireAuth({ apiKey: { id: 1 } } as any, makeResponse(), apiNext);
    expect(apiNext).toHaveBeenCalledTimes(1);

    const formsNext = vi.fn();
    getHandles(makeDb({ authMode: 'forms' }).db).requireAuth({ isAuthenticated: () => true } as any, makeResponse(), formsNext);
    expect(formsNext).toHaveBeenCalledTimes(1);

    const oidcNext = vi.fn();
    getHandles(makeDb({ authMode: 'oidc' }).db).requireAuth({ isAuthenticated: () => true } as any, makeResponse(), oidcNext);
    expect(oidcNext).toHaveBeenCalledTimes(1);

    const basicRes = makeResponse();
    getHandles(makeDb({ authMode: 'basic' }).db).requireAuth({} as any, basicRes, vi.fn());
    expect(basicRes.setHeader).toHaveBeenCalledWith('WWW-Authenticate', 'Basic realm="Filtarr"');
    expect(basicRes.status).toHaveBeenCalledWith(401);

    const basicNext = vi.fn();
    getHandles(makeDb({ authMode: 'basic' }).db).requireAuth({ _basicAuthValid: true } as any, makeResponse(), basicNext);
    expect(basicNext).toHaveBeenCalledTimes(1);

    const deniedRes = makeResponse();
    getHandles(makeDb({ authMode: 'forms' }).db).requireAuth({ isAuthenticated: () => false } as any, deniedRes, vi.fn());
    expect(deniedRes.setHeader).not.toHaveBeenCalled();
    expect(deniedRes.status).toHaveBeenCalledWith(401);
    expect(deniedRes.json).toHaveBeenCalledWith({ error: 'Authentication required' });
  });

  it('handles missing, malformed, valid, and thrown basic-auth flows without breaking the request chain', async () => {
    const noHeaderNext = vi.fn();
    await getHandles(makeDb().db).basicAuth({ headers: {} } as any, makeResponse(), noHeaderNext);
    expect(noHeaderNext).toHaveBeenCalledTimes(1);
    expect(state.bcryptCompare).not.toHaveBeenCalled();

    const malformedNext = vi.fn();
    await getHandles(makeDb().db).basicAuth(
      { headers: { authorization: `Basic ${Buffer.from('admin-only').toString('base64')}` } } as any,
      makeResponse(),
      malformedNext,
    );
    expect(malformedNext).toHaveBeenCalledTimes(1);

    state.bcryptCompare.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('compare failed'));
    const validReq = { headers: { authorization: `Basic ${Buffer.from('admin:secret').toString('base64')}` } } as any;
    await getHandles(makeDb({ basicUser: { username: 'admin', password_hash: 'hash' } }).db).basicAuth(validReq, makeResponse(), vi.fn());
    expect(validReq._basicAuthValid).toBe(true);
    expect(state.bcryptCompare).toHaveBeenCalledWith('secret', 'hash');

    const invalidReq = { headers: { authorization: `Basic ${Buffer.from('admin:secret').toString('base64')}` } } as any;
    const thrownNext = vi.fn();
    await getHandles(makeDb({ basicUser: { username: 'admin', password_hash: 'hash' } }).db).basicAuth(invalidReq, makeResponse(), thrownNext);
    expect(thrownNext).toHaveBeenCalledTimes(1);
    expect(invalidReq._basicAuthValid).toBeUndefined();

    const lookupErrorNext = vi.fn();
    await getHandles(makeDb({ basicLookupThrows: true }).db).basicAuth(
      { headers: { authorization: `Basic ${Buffer.from('admin:secret').toString('base64')}` } } as any,
      makeResponse(),
      lookupErrorNext,
    );
    expect(lookupErrorNext).toHaveBeenCalledTimes(1);
  });

  it('builds session middleware with default and configured cookie settings and wires passport callbacks', () => {
    state.existsSync.mockReturnValue(false);
    const defaultDb = makeDb().db;
    createAuthMiddleware(defaultDb, makeConfig());
    expect(state.sessionFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'filtarr.sid',
        secret: Buffer.alloc(48, 7).toString('hex'),
        cookie: expect.objectContaining({ secure: false, maxAge: 86400000 }),
      }),
    );
    expect(state.mkdirSync).toHaveBeenCalledWith('/tmp/filtarr-data', { recursive: true });
    expect(state.writeFileSync).toHaveBeenCalledWith(
      '/tmp/filtarr-data/.session-secret',
      Buffer.alloc(48, 7).toString('hex'),
      { mode: 384 },
    );

    process.env['NODE_ENV'] = 'production';
    createAuthMiddleware(
      makeDb().db,
      makeConfig({ forms: { sessionSecret: 's'.repeat(32), sessionMaxAge: 9000, cookieName: 'custom.sid' } }),
    );
    expect(state.sessionFactory).toHaveBeenLastCalledWith(
      expect.objectContaining({
        name: 'custom.sid',
        secret: 's'.repeat(32),
        cookie: expect.objectContaining({ secure: true, maxAge: 9000 }),
      }),
    );
    expect(state.passportUse).toHaveBeenCalledTimes(2);
    expect(state.localVerify).toBeTypeOf('function');
    expect(state.serializeUser).toBeTypeOf('function');
    expect(state.deserializeUser).toBeTypeOf('function');
  });

  it('returns configured and persisted session secrets without regenerating them', () => {
    expect(getOrCreateSessionSecret(makeConfig({ forms: { sessionSecret: 'z'.repeat(32) } }))).toBe('z'.repeat(32));

    state.existsSync.mockReturnValue(true);
    state.readFileSync.mockReturnValue('stored-secret\n');
    const secret = getOrCreateSessionSecret(makeConfig());
    expect(secret).toBe('stored-secret');
    expect(state.randomBytes).not.toHaveBeenCalled();
    expect(state.writeFileSync).not.toHaveBeenCalled();
  });

  it('handles passport local-strategy failure branches and reports thrown errors', async () => {
    const missingDb = makeDb({ strategyUser: undefined }).db;
    createAuthMiddleware(missingDb, makeConfig({ forms: { sessionSecret: 'x'.repeat(32) } }));
    const missingDone = vi.fn();
    await state.localVerify('admin', 'secret', missingDone);
    expect(missingDone).toHaveBeenCalledWith(null, false, { message: 'Invalid credentials' });

    const lockedDb = makeDb({ strategyUser: { locked_until: '2999-01-01T00:00:00.000Z', password_hash: 'hash' } }).db;
    createAuthMiddleware(lockedDb, makeConfig({ forms: { sessionSecret: 'x'.repeat(32) } }));
    const lockedDone = vi.fn();
    await state.localVerify('admin', 'secret', lockedDone);
    expect(lockedDone).toHaveBeenCalledWith(null, false, { message: 'Account temporarily locked' });

    const errorDb = makeDb({ strategyLookupThrows: true }).db;
    createAuthMiddleware(errorDb, makeConfig({ forms: { sessionSecret: 'x'.repeat(32) } }));
    const errorDone = vi.fn();
    await state.localVerify('admin', 'secret', errorDone);
    expect(errorDone.mock.calls[0][0]).toEqual(expect.any(Error));
  });

  it('increments lockouts, resets success state, and serializes users through passport callbacks', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-11T00:00:00.000Z'));

    state.bcryptCompare.mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const invalid = makeDb({
      strategyUser: { id: 3, username: 'admin', display_name: 'Admin', password_hash: 'hash', failed_attempts: 2, locked_until: null },
    });
    createAuthMiddleware(invalid.db, makeConfig({ forms: { sessionSecret: 'x'.repeat(32) } }));
    const invalidDone = vi.fn();
    await state.localVerify('admin', 'wrong', invalidDone);
    expect(invalid.failedUpdate.run).toHaveBeenCalledWith(3, null, 3);
    expect(invalidDone).toHaveBeenCalledWith(null, false, { message: 'Invalid credentials' });

    const lockout = makeDb({
      strategyUser: { id: 4, username: 'admin', display_name: 'Admin', password_hash: 'hash', failed_attempts: 4, locked_until: null },
    });
    createAuthMiddleware(lockout.db, makeConfig({ forms: { sessionSecret: 'x'.repeat(32) } }));
    const lockoutDone = vi.fn();
    await state.localVerify('admin', 'wrong', lockoutDone);
    expect(lockout.failedUpdate.run).toHaveBeenCalledWith(5, '2026-03-11T00:15:00.000Z', 4);

    const success = makeDb({
      strategyUser: { id: 5, username: 'admin', display_name: 'Admin', password_hash: 'hash', failed_attempts: 1, locked_until: null },
      deserializeUser: { id: 5, username: 'admin', display_name: 'Admin' },
    });
    createAuthMiddleware(success.db, makeConfig({ forms: { sessionSecret: 'x'.repeat(32) } }));
    const successDone = vi.fn();
    await state.localVerify('admin', 'secret', successDone);
    expect(success.resetUpdate.run).toHaveBeenCalledWith(5);
    expect(successDone).toHaveBeenCalledWith(null, { id: 5, username: 'admin', displayName: 'Admin' });

    const serializeDone = vi.fn();
    state.serializeUser({ id: 5 }, serializeDone);
    expect(serializeDone).toHaveBeenCalledWith(null, 5);

    const deserializeDone = vi.fn();
    state.deserializeUser(5, deserializeDone);
    expect(deserializeDone).toHaveBeenCalledWith(null, { id: 5, username: 'admin', displayName: 'Admin' });

    const missingDeserialize = makeDb({ deserializeUser: undefined });
    createAuthMiddleware(missingDeserialize.db, makeConfig({ forms: { sessionSecret: 'x'.repeat(32) } }));
    const missingDeserializeDone = vi.fn();
    state.deserializeUser(8, missingDeserializeDone);
    expect(missingDeserializeDone).toHaveBeenCalledWith(null, false);
  });
});