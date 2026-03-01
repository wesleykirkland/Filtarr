/**
 * User, session, and API key database schemas.
 * Tables are created via SQL migrations (see src/db/migrations/).
 * This file provides TypeScript types and query helpers.
 */

export interface User {
  id: number;
  username: string;
  password_hash: string;
  display_name: string | null;
  oidc_subject: string | null;
  oidc_issuer: string | null;
  locked_until: string | null;
  failed_attempts: number;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: string;
  user_id: number;
  data: string;
  expires_at: string;
  created_at: string;
}

export interface ApiKey {
  id: number;
  name: string;
  key_hash: string;
  key_prefix: string; // first 8 chars for identification
  key_last4: string; // last 4 chars for display
  user_id: number | null;
  scopes: string; // JSON array of allowed scopes
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

/** Masked API key for API responses — never expose the full key or hash */
export interface ApiKeyResponse {
  id: number;
  name: string;
  maskedKey: string; // "••••••••abcd" (last 4 chars only)
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  revoked: boolean;
}

/** Convert a DB ApiKey row to a safe API response */
export function toApiKeyResponse(row: ApiKey): ApiKeyResponse {
  return {
    id: row.id,
    name: row.name,
    maskedKey: `${'•'.repeat(8)}${row.key_last4}`,
    scopes: JSON.parse(row.scopes || '[]'),
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    revoked: row.revoked_at !== null,
  };
}

/**
 * SQL for creating auth-related tables.
 * Used by the migration runner.
 */
export const AUTH_TABLES_UP = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL DEFAULT '',
  display_name TEXT,
  oidc_subject TEXT,
  oidc_issuer TEXT,
  locked_until TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL DEFAULT '{}',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_last4 TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  scopes TEXT NOT NULL DEFAULT '["*"]',
  expires_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key_prefix ON api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
`;

export const AUTH_TABLES_DOWN = `
DROP TABLE IF EXISTS api_keys;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
`;
