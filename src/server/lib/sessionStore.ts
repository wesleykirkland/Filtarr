import session from 'express-session';
import type Database from 'better-sqlite3';

const DEFAULT_TTL_MS = 86_400_000;
const DEFAULT_PRUNE_INTERVAL_MS = 15 * 60 * 1000;

interface SessionRow {
  id: string;
  data: string;
  expires_at: string;
}

type Callback = (err?: unknown) => void;

export interface SqliteSessionStoreOptions {
  /** How often expired rows are pruned. 0 disables the timer. Default: 15 minutes. */
  pruneIntervalMs?: number;
}

/**
 * Remove every persisted session (e.g. after a password or auth-mode change).
 */
export function destroyAllSessions(db: Database.Database): void {
  db.prepare('DELETE FROM sessions').run();
}

function getUserId(sess: session.SessionData): number | null {
  const user = (sess as { passport?: { user?: unknown } }).passport?.user;
  return typeof user === 'number' && Number.isInteger(user) ? user : null;
}

function getExpiry(sess: session.SessionData): Date {
  const { cookie } = sess;
  if (cookie?.expires) return new Date(cookie.expires);
  if (typeof cookie?.maxAge === 'number') return new Date(Date.now() + cookie.maxAge);
  return new Date(Date.now() + DEFAULT_TTL_MS);
}

/**
 * express-session store backed by the `sessions` table from 001_initial.sql.
 *
 * `user_id` is taken from passport's `passport.user` and is NULL for pre-login sessions;
 * deleting a user cascades to their sessions. Expired rows are pruned on construction and
 * on an unref'd timer, and are never returned by `get`.
 */
export class SqliteSessionStore extends session.Store {
  private readonly db: Database.Database;
  private pruneTimer: NodeJS.Timeout | null = null;

  constructor(db: Database.Database, options: SqliteSessionStoreOptions = {}) {
    super();
    this.db = db;
    this.pruneExpired();

    const interval = options.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS;
    if (interval > 0) {
      this.pruneTimer = setInterval(() => {
        try {
          this.pruneExpired();
        } catch {
          // Database may be closed (e.g. during shutdown); try again next tick.
        }
      }, interval);
      this.pruneTimer.unref();
    }
  }

  /** Delete expired rows. Returns the number removed. */
  pruneExpired(): number {
    return this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString())
      .changes;
  }

  /** Stop the prune timer. */
  close(): void {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.pruneTimer = null;
  }

  private run(callback: Callback | undefined, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      callback?.(err);
      return;
    }
    callback?.();
  }

  override get(sid: string, callback: (err: unknown, session?: session.SessionData | null) => void): void {
    let result: session.SessionData | null = null;
    try {
      const row = this.db
        .prepare<[string], SessionRow>('SELECT id, data, expires_at FROM sessions WHERE id = ?')
        .get(sid);
      if (row) {
        if (new Date(row.expires_at).getTime() <= Date.now()) {
          this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
        } else {
          result = JSON.parse(row.data) as session.SessionData;
        }
      }
    } catch (err) {
      callback(err);
      return;
    }
    callback(null, result);
  }

  override set(sid: string, sess: session.SessionData, callback?: Callback): void {
    this.run(callback, () => {
      this.db
        .prepare(
          `INSERT INTO sessions (id, user_id, data, expires_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             user_id = excluded.user_id, data = excluded.data, expires_at = excluded.expires_at`,
        )
        .run(sid, getUserId(sess), JSON.stringify(sess), getExpiry(sess).toISOString());
    });
  }

  override destroy(sid: string, callback?: Callback): void {
    this.run(callback, () => {
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
    });
  }

  override touch(sid: string, sess: session.SessionData, callback?: () => void): void {
    this.run(callback, () => {
      this.db
        .prepare('UPDATE sessions SET expires_at = ? WHERE id = ?')
        .run(getExpiry(sess).toISOString(), sid);
    });
  }

  override clear(callback?: Callback): void {
    this.run(callback, () => destroyAllSessions(this.db));
  }

  override length(callback: (err: unknown, length?: number) => void): void {
    let count: number;
    try {
      count =
        this.db
          .prepare<[string], { count: number }>(
            'SELECT COUNT(*) AS count FROM sessions WHERE expires_at > ?',
          )
          .get(new Date().toISOString())?.count ?? 0;
    } catch (err) {
      callback(err);
      return;
    }
    callback(null, count);
  }

  override all(
    callback: (
      err: unknown,
      obj?: session.SessionData[] | { [sid: string]: session.SessionData } | null,
    ) => void,
  ): void {
    const sessions: { [sid: string]: session.SessionData } = {};
    try {
      const rows = this.db
        .prepare<[string], SessionRow>('SELECT id, data, expires_at FROM sessions WHERE expires_at > ?')
        .all(new Date().toISOString());
      for (const row of rows) sessions[row.id] = JSON.parse(row.data) as session.SessionData;
    } catch (err) {
      callback(err);
      return;
    }
    callback(null, sessions);
  }
}
