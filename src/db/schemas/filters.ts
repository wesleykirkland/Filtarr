import type Database from 'better-sqlite3';
import { decryptStoredSecret, encryptStoredSecret } from '../../services/encryption.js';

export interface FilterRow {
  id: number;
  name: string;
  description: string | null;
  trigger_source: string;
  rule_type: string;
  rule_payload: string;
  action_type: string;
  action_payload: string | null;
  target_path: string | null;
  is_built_in: number;
  notify_on_match: number;
  notify_webhook_url: string | null;
  notify_slack: number;
  notify_slack_token: string | null;
  notify_slack_channel: string | null;
  instance_id: number | null;
  enabled: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface FilterResponseRow extends Omit<FilterRow, 'notify_webhook_url' | 'notify_slack_token'> {
  notify_webhook_url: null;
  notify_webhook_url_configured: boolean;
  notify_slack_token: null;
  notify_slack_token_configured: boolean;
}

export interface CreateFilterInput {
  name: string;
  description?: string;
  triggerSource: string;
  ruleType: string;
  rulePayload: string;
  actionType: string;
  actionPayload?: string;
  targetPath?: string;
  notifyOnMatch?: boolean;
  notifyWebhookUrl?: string;
  notifySlack?: boolean;
  notifySlackToken?: string;
  notifySlackChannel?: string;
  instanceId?: number;
  enabled?: boolean;
  sortOrder?: number;
}

export interface UpdateFilterInput {
  name?: string;
  description?: string;
  triggerSource?: string;
  ruleType?: string;
  rulePayload?: string;
  actionType?: string;
  actionPayload?: string;
  targetPath?: string;
  notifyOnMatch?: boolean;
  notifyWebhookUrl?: string;
  notifySlack?: boolean;
  notifySlackToken?: string;
  notifySlackChannel?: string;
  instanceId?: number;
  enabled?: boolean;
  sortOrder?: number;
}

function normalizeNullableText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function rowToFilter(row: FilterRow): FilterRow {
  return {
    ...row,
    notify_webhook_url: decryptStoredSecret(row.notify_webhook_url),
    notify_slack_token: decryptStoredSecret(row.notify_slack_token),
  };
}

export function toFilterResponse(row: FilterRow): FilterResponseRow {
  return {
    ...row,
    notify_webhook_url: null,
    notify_webhook_url_configured: Boolean(row.notify_webhook_url),
    notify_slack_token: null,
    notify_slack_token_configured: Boolean(row.notify_slack_token),
  };
}

export function getAllFilters(db: Database.Database): FilterRow[] {
  return db
    .prepare<[], FilterRow>('SELECT * FROM filters ORDER BY sort_order ASC, created_at DESC')
    .all()
    .map(rowToFilter);
}

export function getFilterById(db: Database.Database, id: number): FilterRow | null {
  const result = db.prepare<[number], FilterRow>('SELECT * FROM filters WHERE id = ?').get(id);
  return result ? rowToFilter(result) : null;
}

export function createFilter(db: Database.Database, input: CreateFilterInput): FilterRow {
  const notifyWebhookUrl = normalizeNullableText(input.notifyWebhookUrl);
  const notifySlackToken = normalizeNullableText(input.notifySlackToken);
  const notifySlackChannel = normalizeNullableText(input.notifySlackChannel);
  const result = db
    .prepare(
      `INSERT INTO filters (
         name, description, trigger_source, rule_type, rule_payload,
         action_type, action_payload, target_path,
         notify_on_match, notify_webhook_url, notify_slack,
         notify_slack_token, notify_slack_channel,
         instance_id,
         enabled, sort_order, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    )
    .run(
      input.name,
      input.description || null,
      input.triggerSource,
      input.ruleType,
      input.rulePayload,
      input.actionType,
      input.actionPayload || null,
      input.targetPath || null,
      input.notifyOnMatch ? 1 : 0,
      encryptStoredSecret(notifyWebhookUrl),
      input.notifySlack ? 1 : 0,
      encryptStoredSecret(notifySlackToken),
      notifySlackChannel,
      input.instanceId || null,
      input.enabled !== false ? 1 : 0,
      input.sortOrder || 0,
    );

  const newRow = getFilterById(db, result.lastInsertRowid as number);
  if (!newRow) throw new Error('Failed to retrieve created filter');
  return newRow;
}

export function updateFilter(
  db: Database.Database,
  id: number,
  input: UpdateFilterInput,
): FilterRow {
  const current = getFilterById(db, id);
  if (!current) throw new Error(`Filter with id ${id} not found`);

  const name = input.name ?? current.name;
  const description = input.description !== undefined ? input.description : current.description;
  const triggerSource = input.triggerSource ?? current.trigger_source;
  const ruleType = input.ruleType ?? current.rule_type;
  const rulePayload = input.rulePayload ?? current.rule_payload;
  const actionType = input.actionType ?? current.action_type;
  const actionPayload =
    input.actionPayload !== undefined ? input.actionPayload : current.action_payload;
  const targetPath = input.targetPath !== undefined ? input.targetPath : current.target_path;
  const notifyOnMatch =
    input.notifyOnMatch !== undefined ? (input.notifyOnMatch ? 1 : 0) : current.notify_on_match;
  const notifyWebhookUrl =
    input.notifyWebhookUrl !== undefined
      ? normalizeNullableText(input.notifyWebhookUrl)
      : current.notify_webhook_url;
  const notifySlack =
    input.notifySlack !== undefined ? (input.notifySlack ? 1 : 0) : current.notify_slack;
  const notifySlackToken =
    input.notifySlackToken !== undefined
      ? normalizeNullableText(input.notifySlackToken)
      : current.notify_slack_token;
  const notifySlackChannel =
    input.notifySlackChannel !== undefined
      ? normalizeNullableText(input.notifySlackChannel)
      : current.notify_slack_channel;
  const instanceId = input.instanceId !== undefined ? input.instanceId : current.instance_id;
  const enabled = input.enabled !== undefined ? (input.enabled ? 1 : 0) : current.enabled;
  const sortOrder = input.sortOrder ?? current.sort_order;

  db.prepare(
    `UPDATE filters
     SET name = ?, description = ?, trigger_source = ?, rule_type = ?, rule_payload = ?,
         action_type = ?, action_payload = ?, target_path = ?,
         notify_on_match = ?, notify_webhook_url = ?, notify_slack = ?,
         notify_slack_token = ?, notify_slack_channel = ?,
         instance_id = ?, enabled = ?, sort_order = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(
    name,
    description || null,
    triggerSource,
    ruleType,
    rulePayload,
    actionType,
    actionPayload || null,
    targetPath || null,
    notifyOnMatch,
    encryptStoredSecret(notifyWebhookUrl),
    notifySlack,
    encryptStoredSecret(notifySlackToken),
    notifySlackChannel || null,
    instanceId,
    enabled,
    sortOrder,
    id,
  );

  const updatedRow = getFilterById(db, id);
  if (!updatedRow) throw new Error('Failed to retrieve updated filter');
  return updatedRow;
}

export function deleteFilter(db: Database.Database, id: number): boolean {
  const current = getFilterById(db, id);
  if (!current) return false;
  if (current.is_built_in) throw new Error('Built-in filters cannot be deleted');
  const result = db.prepare<[number]>('DELETE FROM filters WHERE id = ?').run(id);
  return result.changes > 0;
}
