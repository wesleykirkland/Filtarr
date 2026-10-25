import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_TABLES_UP } from '../../src/db/schemas/users.js';

const state = vi.hoisted(() => {
  const box: any = {};
  box.apiKeyHandle = vi.fn((_req, _res, next) => next());
  box.sessionHandle = vi.fn((_req, _res, next) => next());
  box.passportInitializeHandle = vi.fn((_req, _res, next) => next());
  box.passportSessionHandle = vi.fn((_req, _res, next) => next());
  box.apiKeyMiddleware = vi.fn(() => box.apiKeyHandle);
  box.sessionFactory = vi.fn(() => box.sessionHandle);
  box.MemoryStore = vi.fn(function (this: any) {
    this.clear = vi.fn((cb: () => void) => cb());
  });
  box.sessionFactory.MemoryStore = box.MemoryStore;
  box.SqliteSessionStore = vi.fn(function (this: any) {
    this.clear = vi.fn((cb: () => void) => cb());
  });
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
  box.bcryptHash = vi.fn().mockResolvedValue('$2b$12$' + 'a'.repeat(53));
  box.existsSync = vi.fn();
  box.mkdirSync = vi.fn();
  box.readFileSync = vi.fn();
  box.writeFileSync = vi.fn();
  box.randomBytes = vi.fn(() => Buffer.alloc(48, 7));
  box.getConfig = vi.fn(() => ({ dataDir: '/tmp/filtarr-data', nodeEnv: 'test' }));
  box.loggerWarn = vi.fn();
  box.localVerify = undefined;
  box.serializeUser = undefined;
  box.deserializeUser = undefined;
  return box;
});

vi.mock('../../src/server/middleware/apiKey.js', () => ({ apiKeyMiddleware: state.apiKeyMiddleware }));
vi.mock('express-session', () => ({ default: state.sessionFactory }));
vi.mock('../../src/server/lib/sessionStore.js', () => ({
  SqliteSessionStore: state.SqliteSessionStore,
}));
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
vi.mock('bcrypt', () => ({ default: { compare: state.bcryptCompare, hash: state.bcryptHash } }));
vi.mock('node:fs', () => ({
  existsSync: state.existsSync,
  mkdirSync: state.mkdirSync,
  readFileSync: state.readFileSync,
  writeFileSync: state.writeFileSync,
}));
vi.mock('node:crypto', () => ({ default: { randomBytes: state.randomBytes } }));
vi.mock('../../src/config/index.js', () => ({ getConfig: state.getConfig }));
vi.mock('../../src/server/lib/logger.js', () => ({
  logger: { warn: state.loggerWarn, error: vi.fn(), info: vi.fn() },
}));

import {
  createAuthMiddleware,
  getOrCreateSessionSecret,
  invalidateAllSessions,
  verifyUserCredentials,
} from '../../src/server/middleware/auth.js';

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
  const db = new Database(':memory:');
  if (!options.authModeThrows) {
    db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)');
    if (options.authMode !== undefined) {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('auth_mode', options.authMode);
    }
    if (!options.setupPending) {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('setup_complete', 'true');
    }
  }
  db.exec(AUTH_TABLES_UP);
  const user = options.strategyUser;
  if (user) {
    db.prepare(
      `INSERT INTO users (id, username, password_hash, display_name, failed_attempts, locked_until)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      user.id ?? 1,
      user.username ?? 'admin',
      user.password_hash ?? 'hash',
      user.display_name ?? null,
      user.failed_attempts ?? 0,
      user.locked_until ?? null,
    );
  }
  const getUser = (id = 1) =>
    db.prepare('SELECT failed_attempts, locked_until FROM users WHERE id = ?').get(id) as {
      failed_attempts: number;
      locked_until: string | null;
    };
  return { db: db as any, getUser };
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
    vi.clearAllMocks();
    state.bcryptCompare.mockReset();
    state.readFileSync.mockReset();
    state.readFileSync.mockImplementation(() => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    });
    state.existsSync.mockReset();
    state.randomBytes.mockReturnValue(Buffer.alloc(48, 7));
    state.getConfig.mockReturnValue({ dataDir: '/tmp/filtarr-data', nodeEnv: 'test' });
    state.localVerify = undefined;
    state.serializeUser = undefined;
    state.deserializeUser = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('enforces requireAuth across auth modes and fails closed when the settings lookup throws', () => {
    const failedRes = makeResponse();
    const failedNext = vi.fn();
    getHandles(makeDb({ authModeThrows: true }).db).requireAuth({} as any, failedRes, failedNext);
    expect(failedNext).not.toHaveBeenCalled();
    expect(failedRes.status).toHaveBeenCalledWith(503);
    expect(failedRes.json).toHaveBeenCalledWith({ error: 'Authentication unavailable' });

    const noneNext = vi.fn();
    getHandles(makeDb({ authMode: 'none' }).db).requireAuth({} as any, makeResponse(), noneNext);
    expect(noneNext).toHaveBeenCalledTimes(1);

    const unsetNext = vi.fn();
    getHandles(makeDb().db).requireAuth({} as any, makeResponse(), unsetNext);
    expect(unsetNext).toHaveBeenCalledTimes(1);

    const pendingRes = makeResponse();
    const pendingNext = vi.fn();
    getHandles(makeDb({ setupPending: true }).db).requireAuth(
      { apiKey: { id: 1 }, isAuthenticated: () => true } as any,
      pendingRes,
      pendingNext,
    );
    expect(pendingNext).not.toHaveBeenCalled();
    expect(pendingRes.status).toHaveBeenCalledWith(401);

    const apiNext = vi.fn();
    getHandles(makeDb({ authMode: 'forms' }).db).requireAuth({ apiKey: { id: 1 } } as any, makeResponse(), apiNext);
    expect(apiNext).toHaveBeenCalledTimes(1);

    const formsNext = vi.fn();
    getHandles(makeDb({ authMode: 'forms' }).db).requireAuth({ isAuthenticated: () => true } as any, makeResponse(), formsNext);
    expect(formsNext).toHaveBeenCalledTimes(1);

    // Sessions are honored only in forms mode (no OIDC strategy ships, and stale forms
    // sessions must not survive a switch to basic/oidc).
    for (const mode of ['oidc', 'basic']) {
      const sessionRes = makeResponse();
      const sessionNext = vi.fn();
      getHandles(makeDb({ authMode: mode }).db).requireAuth({ isAuthenticated: () => true } as any, sessionRes, sessionNext);
      expect(sessionNext).not.toHaveBeenCalled();
      expect(sessionRes.status).toHaveBeenCalledWith(401);
    }

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

  it('ignores Basic credentials entirely outside basic mode', async () => {
    const header = { authorization: `Basic ${Buffer.from('admin:secret').toString('base64')}` };
    for (const mode of ['forms', 'none', 'oidc']) {
      const { db } = makeDb({ authMode: mode, strategyUser: { id: 1 } });
      const req = { headers: header } as any;
      const next = vi.fn();
      await getHandles(db).basicAuth(req, makeResponse(), next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(req._basicAuthValid).toBeUndefined();
    }
    expect(state.bcryptCompare).not.toHaveBeenCalled();
  });

  describe('verifyUserCredentials', () => {
    it('counts failures, locks at the threshold, and rejects locked accounts without comparing the real hash', async () => {
      const { db, getUser } = makeDb({ strategyUser: { id: 7, failed_attempts: 3 } });

      state.bcryptCompare.mockResolvedValue(false);
      await expect(verifyUserCredentials(db, 'admin', 'wrong')).resolves.toEqual({ ok: false, reason: 'invalid' });
      expect(getUser(7)).toEqual({ failed_attempts: 4, locked_until: null });

      await expect(verifyUserCredentials(db, 'admin', 'wrong')).resolves.toEqual({ ok: false, reason: 'invalid' });
      const locked = getUser(7);
      expect(locked.failed_attempts).toBe(5);
      const lockMs = new Date(locked.locked_until ?? 0).getTime() - Date.now();
      expect(lockMs).toBeGreaterThan(14 * 60 * 1000);
      expect(lockMs).toBeLessThanOrEqual(15 * 60 * 1000);

      // Locked: even the right password is refused, and the real hash is never compared
      state.bcryptCompare.mockClear().mockResolvedValue(true);
      await expect(verifyUserCredentials(db, 'admin', 'right')).resolves.toEqual({ ok: false, reason: 'locked' });
      expect(state.bcryptCompare).toHaveBeenCalledTimes(1);
      expect(state.bcryptCompare.mock.calls[0][1]).not.toBe('hash');
      expect(getUser(7).failed_attempts).toBe(5);
    });

    it('reserves attempts atomically so 10 parallel wrong passwords stop at exactly the threshold', async () => {
      const { db, getUser } = makeDb({ strategyUser: { id: 1 } });
      state.bcryptCompare.mockImplementation(
        (_pw: string, hash: string) => new Promise((resolve) => setTimeout(() => resolve(hash === 'never'), 5)),
      );

      const results = await Promise.all(
        Array.from({ length: 10 }, () => verifyUserCredentials(db, 'admin', 'wrong')),
      );

      const reasons = results.map((r) => (r.ok ? 'ok' : r.reason));
      expect(reasons.filter((r) => r === 'invalid')).toHaveLength(5);
      expect(reasons.filter((r) => r === 'locked')).toHaveLength(5);
      expect(getUser(1).failed_attempts).toBe(5);
      expect(getUser(1).locked_until).not.toBeNull();
      // Only the 5 reserved attempts touched the real hash
      expect(state.bcryptCompare.mock.calls.filter((c: unknown[]) => c[1] === 'hash')).toHaveLength(5);
    });

    it('restarts the count after an expired lock and resets on success', async () => {
      const { db, getUser } = makeDb({
        strategyUser: { id: 2, failed_attempts: 5, locked_until: '2000-01-01T00:00:00.000Z' },
      });
      state.bcryptCompare.mockResolvedValueOnce(false);
      await verifyUserCredentials(db, 'admin', 'wrong');
      expect(getUser(2)).toEqual({ failed_attempts: 1, locked_until: null });

      state.bcryptCompare.mockResolvedValueOnce(true);
      const ok = await verifyUserCredentials(db, 'admin', 'right');
      expect(ok.ok).toBe(true);
      expect(getUser(2)).toEqual({ failed_attempts: 0, locked_until: null });
    });

    it('runs a dummy bcrypt comparison for unknown users', async () => {
      const { db } = makeDb();
      state.bcryptCompare.mockResolvedValue(false);
      await expect(verifyUserCredentials(db, 'ghost', 'pw')).resolves.toEqual({ ok: false, reason: 'unknown_user' });
      expect(state.bcryptCompare).toHaveBeenCalledTimes(1);
      expect(state.bcryptCompare.mock.calls[0][1]).toMatch(/^\$2b\$12\$/);
    });
  });

  it('honors an explicit cookieSecure override and derives the default from getConfig().nodeEnv', () => {
    state.getConfig.mockReturnValue({ dataDir: '/tmp/filtarr-data', nodeEnv: 'production' });
    createAuthMiddleware(makeDb().db, makeConfig({ forms: { sessionSecret: 's'.repeat(32) }, cookieSecure: false }));
    expect(state.sessionFactory).toHaveBeenLastCalledWith(
      expect.objectContaining({ cookie: expect.objectContaining({ secure: false }) }),
    );

    createAuthMiddleware(makeDb().db, makeConfig({ forms: { sessionSecret: 's'.repeat(32) } }));
    expect(state.sessionFactory).toHaveBeenLastCalledWith(
      expect.objectContaining({ cookie: expect.objectContaining({ secure: true }) }),
    );

    state.getConfig.mockReturnValue({ dataDir: '/tmp/filtarr-data', nodeEnv: 'test' });
    createAuthMiddleware(makeDb().db, makeConfig({ forms: { sessionSecret: 's'.repeat(32) }, cookieSecure: 'auto' }));
    expect(state.sessionFactory).toHaveBeenLastCalledWith(
      expect.objectContaining({ cookie: expect.objectContaining({ secure: 'auto' }) }),
    );
  });

  it('builds session middleware with default and configured cookie settings and wires passport callbacks', () => {
    state.existsSync.mockReturnValue(false);
    createAuthMiddleware(makeDb().db, makeConfig());
    expect(state.sessionFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'filtarr.sid',
        secret: Buffer.alloc(48, 7).toString('hex'),
        store: expect.any(state.SqliteSessionStore),
        cookie: expect.objectContaining({ secure: false, maxAge: 86400000 }),
      }),
    );
    expect(state.mkdirSync).toHaveBeenCalledWith('/tmp/filtarr-data', { recursive: true });
    expect(state.writeFileSync).toHaveBeenCalledWith(
      '/tmp/filtarr-data/.session-secret',
      Buffer.alloc(48, 7).toString('hex'),
      { mode: 384 },
    );

    createAuthMiddleware(
      makeDb().db,
      makeConfig({ forms: { sessionSecret: 's'.repeat(32), sessionMaxAge: 9000, cookieName: 'custom.sid' } }),
    );
    expect(state.sessionFactory).toHaveBeenLastCalledWith(
      expect.objectContaining({
        name: 'custom.sid',
        secret: 's'.repeat(32),
        cookie: expect.objectContaining({ maxAge: 9000 }),
      }),
    );
    expect(state.passportUse).toHaveBeenCalledTimes(2);
    expect(state.localVerify).toBeTypeOf('function');
    expect(state.serializeUser).toBeTypeOf('function');
    expect(state.deserializeUser).toBeTypeOf('function');
  });

  it('invalidateAllSessions clears every session store', async () => {
    createAuthMiddleware(makeDb().db, makeConfig({ forms: { sessionSecret: 'x'.repeat(32) } }));
    const store = state.SqliteSessionStore.mock.instances.at(-1);
    await invalidateAllSessions();
    expect(store.clear).toHaveBeenCalled();
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

  it('returns the same generic message for unknown, wrong, and locked logins and logs the real reason', async () => {
    const config = makeConfig({ forms: { sessionSecret: 'x'.repeat(32) } });
    state.bcryptCompare.mockResolvedValue(false);

    createAuthMiddleware(makeDb().db, config);
    const missingDone = vi.fn();
    await state.localVerify('admin', 'secret', missingDone);
    expect(missingDone).toHaveBeenCalledWith(null, false, { message: 'Invalid credentials' });

    createAuthMiddleware(makeDb({ strategyUser: { id: 1 } }).db, config);
    const wrongDone = vi.fn();
    await state.localVerify('admin', 'secret', wrongDone);
    expect(wrongDone).toHaveBeenCalledWith(null, false, { message: 'Invalid credentials' });

    createAuthMiddleware(makeDb({ strategyUser: { id: 1, locked_until: '2999-01-01T00:00:00.000Z' } }).db, config);
    const lockedDone = vi.fn();
    await state.localVerify('admin', 'secret', lockedDone);
    expect(lockedDone).toHaveBeenCalledWith(null, false, { message: 'Invalid credentials' });

    expect(state.loggerWarn.mock.calls.map((c: any[]) => c[0].reason)).toEqual(['unknown_user', 'invalid', 'locked']);

    const errorDb = makeDb().db;
    errorDb.exec('DROP TABLE users');
    createAuthMiddleware(errorDb, config);
    const errorDone = vi.fn();
    await state.localVerify('admin', 'secret', errorDone);
    expect(errorDone.mock.calls[0][0]).toEqual(expect.any(Error));
  });

  it('resets lockouts on success and serializes users through passport callbacks', async () => {
    const success = makeDb({
      strategyUser: { id: 5, display_name: 'Admin', failed_attempts: 1 },
    });
    state.bcryptCompare.mockResolvedValueOnce(true);
    createAuthMiddleware(success.db, makeConfig({ forms: { sessionSecret: 'x'.repeat(32) } }));
    const successDone = vi.fn();
    await state.localVerify('admin', 'secret', successDone);
    expect(success.getUser(5)).toEqual({ failed_attempts: 0, locked_until: null });
    expect(successDone).toHaveBeenCalledWith(null, { id: 5, username: 'admin', displayName: 'Admin' });

    const serializeDone = vi.fn();
    state.serializeUser({ id: 5 }, serializeDone);
    expect(serializeDone).toHaveBeenCalledWith(null, 5);

    const deserializeDone = vi.fn();
    state.deserializeUser(5, deserializeDone);
    expect(deserializeDone).toHaveBeenCalledWith(null, { id: 5, username: 'admin', displayName: 'Admin' });

    const missingDeserializeDone = vi.fn();
    state.deserializeUser(8, missingDeserializeDone);
    expect(missingDeserializeDone).toHaveBeenCalledWith(null, false);
  });
});
