/**
 * Database schema helpers for arr_instances table.
 * Provides typed CRUD operations with encryption/decryption of API keys.
 */

import type { Database } from 'better-sqlite3';
import type { ArrType, ArrInstanceConfig, ArrInstanceResponse } from '../../services/arr/types.js';
import { encrypt, decrypt, maskApiKey } from '../../services/encryption.js';

// ── Row type matching SQLite schema ─────────────────────────────────────────

interface InstanceRow {
  id: number;
  name: string;
  type: string;
  url: string;
  api_key_encrypted: string;
  timeout: number;
  enabled: number; // SQLite boolean
  created_at: string;
  updated_at: string;
}

// ── Input types ─────────────────────────────────────────────────────────────

export interface CreateInstanceInput {
  name: string;
  type: ArrType;
  url: string;
  apiKey: string;
  timeout?: number;
  enabled?: boolean;
}

export interface UpdateInstanceInput {
  name?: string;
  type?: ArrType;
  url?: string;
  apiKey?: string;
  timeout?: number;
  enabled?: boolean;
}

// ── Query functions ─────────────────────────────────────────────────────────

function rowToConfig(row: InstanceRow): ArrInstanceConfig {
  return {
    id: row.id,
    name: row.name,
    type: row.type as ArrType,
    url: row.url,
    apiKey: decrypt(row.api_key_encrypted),
    timeout: row.timeout,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToResponse(row: InstanceRow): ArrInstanceResponse {
  const decryptedKey = decrypt(row.api_key_encrypted);
  return {
    id: row.id,
    name: row.name,
    type: row.type as ArrType,
    url: row.url,
    apiKey: maskApiKey(decryptedKey),
    timeout: row.timeout,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Get all instances (API-safe, masked keys) */
export function getAllInstances(db: Database): ArrInstanceResponse[] {
  const rows = db.prepare('SELECT * FROM arr_instances ORDER BY name').all() as InstanceRow[];
  return rows.map(rowToResponse);
}

/** Get a single instance by ID (API-safe, masked key) */
export function getInstanceById(db: Database, id: number): ArrInstanceResponse | null {
  const row = db.prepare('SELECT * FROM arr_instances WHERE id = ?').get(id) as InstanceRow | undefined;
  return row ? rowToResponse(row) : null;
}

/** Get a single instance with decrypted API key (internal use only) */
export function getInstanceConfigById(db: Database, id: number): ArrInstanceConfig | null {
  const row = db.prepare('SELECT * FROM arr_instances WHERE id = ?').get(id) as InstanceRow | undefined;
  return row ? rowToConfig(row) : null;
}

/** Get all enabled instances with decrypted API keys (internal use only) */
export function getEnabledInstanceConfigs(db: Database): ArrInstanceConfig[] {
  const rows = db.prepare('SELECT * FROM arr_instances WHERE enabled = 1 ORDER BY name').all() as InstanceRow[];
  return rows.map(rowToConfig);
}

/** Create a new instance */
export function createInstance(db: Database, input: CreateInstanceInput): ArrInstanceResponse {
  const encryptedKey = encrypt(input.apiKey);
  const stmt = db.prepare(`
    INSERT INTO arr_instances (name, type, url, api_key_encrypted, timeout, enabled)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    input.name,
    input.type,
    input.url.replace(/\/+$/, ''), // normalize URL
    encryptedKey,
    input.timeout ?? 30000,
    input.enabled !== false ? 1 : 0,
  );

  return getInstanceById(db, result.lastInsertRowid as number)!;
}

/** Update an existing instance */
export function updateInstance(db: Database, id: number, input: UpdateInstanceInput): ArrInstanceResponse | null {
  const existing = db.prepare('SELECT * FROM arr_instances WHERE id = ?').get(id) as InstanceRow | undefined;
  if (!existing) return null;

  const updates: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) { updates.push('name = ?'); values.push(input.name); }
  if (input.type !== undefined) { updates.push('type = ?'); values.push(input.type); }
  if (input.url !== undefined) { updates.push('url = ?'); values.push(input.url.replace(/\/+$/, '')); }
  if (input.apiKey !== undefined) { updates.push('api_key_encrypted = ?'); values.push(encrypt(input.apiKey)); }
  if (input.timeout !== undefined) { updates.push('timeout = ?'); values.push(input.timeout); }
  if (input.enabled !== undefined) { updates.push('enabled = ?'); values.push(input.enabled ? 1 : 0); }

  if (updates.length === 0) return getInstanceById(db, id);

  updates.push("updated_at = datetime('now')");
  values.push(id);

  db.prepare(`UPDATE arr_instances SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  return getInstanceById(db, id);
}

/** Delete an instance */
export function deleteInstance(db: Database, id: number): boolean {
  const result = db.prepare('DELETE FROM arr_instances WHERE id = ?').run(id);
  return result.changes > 0;
}
