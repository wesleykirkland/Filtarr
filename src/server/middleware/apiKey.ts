import {
  Router,
  type Request,
  type Response,
  type NextFunction,
  type RequestHandler,
} from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import type Database from 'better-sqlite3';
import type { ApiKey } from '../../db/schemas/users.js';

const API_KEY_HEADER = 'x-api-key';
const API_KEY_BYTE_LENGTH = 32; // 256-bit keys
const API_KEY_PREFIX = 'flt_'; // Filtarr API key prefix for easy identification

/**
 * API key scopes. They are hierarchical: `admin` implies `write`, which implies `read`.
 * `*` (used by the initial setup key) grants everything.
 *
 * - read:  GET/HEAD requests on protected routes
 * - write: mutating requests on instances, directories, filters, jobs, settings (app,
 *          notifications, backup)
 * - admin: API-key management, auth-mode changes and backup import
 */
export const API_KEY_SCOPES = ['read', 'write', 'admin'] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];
export const DEFAULT_API_KEY_SCOPES: ApiKeyScope[] = ['write'];

const SCOPE_RANK: Record<ApiKeyScope, number> = { read: 1, write: 2, admin: 3 };

export function isApiKeyScope(value: unknown): value is ApiKeyScope {
  return typeof value === 'string' && (API_KEY_SCOPES as readonly string[]).includes(value);
}

/** Whether a set of granted scopes satisfies `required` (`*` or a higher scope also satisfies it). */
export function hasScope(granted: readonly string[], required: ApiKeyScope): boolean {
  return granted.some(
    (scope) => scope === '*' || (isApiKeyScope(scope) && SCOPE_RANK[scope] >= SCOPE_RANK[required]),
  );
}

function parseScopes(raw: string | null | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(raw || '["*"]');
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    // Corrupt scope data grants nothing rather than everything.
    return [];
  }
}

export interface ApiKeyContext {
  apiKeyId: number;
  apiKeyName: string;
  userId: number | null;
  scopes: string[];
}

// Extend Express Request type to include apiKey
/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace Express {
    interface Request {
      apiKey?: ApiKeyContext;
    }
  }
}
/* eslint-enable @typescript-eslint/no-namespace */

/**
 * Generate a new cryptographically random API key.
 * Format: flt_<64 hex chars> (32 bytes = 256 bits)
 */
export function generateApiKey(): string {
  const bytes = crypto.randomBytes(API_KEY_BYTE_LENGTH);
  return `${API_KEY_PREFIX}${bytes.toString('hex')}`;
}

/**
 * Hash an API key for storage using bcrypt.
 */
export function hashApiKey(key: string, rounds: number = 12): Promise<string> {
  return bcrypt.hash(key, rounds);
}

/**
 * Extract prefix and last4 from an API key for identification/display.
 */
export function getKeyIdentifiers(key: string): { prefix: string; last4: string } {
  return {
    prefix: key.substring(0, 12), // "flt_" + first 8 hex chars
    last4: key.slice(-4),
  };
}

/**
 * Validate an API key against the database.
 * Uses prefix-based lookup to narrow candidates, then bcrypt compare.
 */
async function validateApiKey(
  db: Database.Database,
  providedKey: string,
): Promise<ApiKeyContext | null> {
  const { prefix } = getKeyIdentifiers(providedKey);

  // Find candidate keys by prefix (narrows bcrypt comparisons)
  const candidates = db
    .prepare<[string], ApiKey>(
      `SELECT * FROM api_keys
     WHERE key_prefix = ? AND revoked_at IS NULL
     AND (expires_at IS NULL OR expires_at > datetime('now'))`,
    )
    .all(prefix);

  for (const candidate of candidates) {
    const matches = await bcrypt.compare(providedKey, candidate.key_hash);
    if (matches) {
      // Update last_used_at
      db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(
        candidate.id,
      );

      return {
        apiKeyId: candidate.id,
        apiKeyName: candidate.name,
        userId: candidate.user_id,
        scopes: parseScopes(candidate.scopes),
      };
    }
  }

  return null;
}

/**
 * API key authentication middleware.
 * Checks X-Api-Key header and validates against stored hashes.
 * If valid, sets req.apiKey with key context.
 * If no API key header is present, passes through (other auth may handle it).
 */
export function apiKeyMiddleware(db: Database.Database) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const apiKey = req.headers[API_KEY_HEADER] as string | undefined;

    if (!apiKey) {
      // No API key provided — let other auth middleware handle it
      next();
      return;
    }

    // Validate format
    if (!apiKey.startsWith(API_KEY_PREFIX) || apiKey.length < 20) {
      res.status(401).json({ error: 'Invalid API key format' });
      return;
    }

    try {
      const keyContext = await validateApiKey(db, apiKey);
      if (!keyContext) {
        res.status(401).json({ error: 'Invalid or expired API key' });
        return;
      }

      req.apiKey = keyContext;
      next();
    } catch (err) {
      next(err);
    }
  };
}

function sendInsufficientScope(res: Response, required: ApiKeyScope): void {
  res.status(403).json({ error: `API key lacks the required '${required}' scope` });
}

/**
 * Require an API-key-authenticated request to carry `scope`. Requests authenticated any other
 * way (session, Basic, or auth mode "none") are not API-key restricted and pass through;
 * `requireAuth` remains responsible for rejecting unauthenticated requests.
 */
export function requireScope(scope: ApiKeyScope): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.apiKey && !hasScope(req.apiKey.scopes, scope)) {
      sendInsufficientScope(res, scope);
      return;
    }
    next();
  };
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface ScopedRouterOptions {
  /** Paths (relative to the mount point) that need `admin` for any method, e.g. '/auth-mode'. */
  admin?: string[];
}

function matchesPath(path: string, prefix: string): boolean {
  // Express routing is case-insensitive by default, so compare case-insensitively too.
  const lower = path.toLowerCase();
  const target = prefix.toLowerCase();
  return lower === target || lower.startsWith(`${target}/`);
}

/**
 * Wrap a router so API-key requests need `read` for GET/HEAD/OPTIONS, `write` for any other
 * method, and `admin` for the listed paths. Mount it after `requireAuth`:
 *   app.use('/api/v1/filters', requireAuth, scopedRouter(createFiltersRoutes(db)));
 */
export function scopedRouter(router: RequestHandler, options: ScopedRouterOptions = {}): Router {
  const wrapper = Router();
  const adminPaths = options.admin ?? [];
  wrapper.use((req: Request, res: Response, next: NextFunction): void => {
    if (!req.apiKey) {
      next();
      return;
    }
    let required: ApiKeyScope = READ_METHODS.has(req.method) ? 'read' : 'write';
    if (adminPaths.some((p) => matchesPath(req.path, p))) required = 'admin';
    if (!hasScope(req.apiKey.scopes, required)) {
      sendInsufficientScope(res, required);
      return;
    }
    next();
  });
  wrapper.use(router);
  return wrapper;
}

/**
 * Create and store the initial API key on first run.
 * Prints the key to stdout so the user can capture it.
 * Returns the plaintext key (only time it's available).
 */
export async function createInitialApiKey(
  db: Database.Database,
  bcryptRounds: number = 12,
): Promise<string> {
  const existingKeys = db.prepare('SELECT COUNT(*) as count FROM api_keys').get() as {
    count: number;
  };
  if (existingKeys.count > 0) {
    return ''; // Keys already exist, skip
  }

  const key = generateApiKey();
  const keyHash = await hashApiKey(key, bcryptRounds);
  const { prefix, last4 } = getKeyIdentifiers(key);

  db.prepare(
    `INSERT INTO api_keys (name, key_hash, key_prefix, key_last4, scopes)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('Initial API Key', keyHash, prefix, last4, '["*"]');

  console.log('');
  console.log('='.repeat(60));
  console.log("  FILTARR INITIAL API KEY (save this — it won't be shown again)");
  console.log(`  API Key: ${key}`);
  console.log('='.repeat(60));
  console.log('');

  return key;
}
