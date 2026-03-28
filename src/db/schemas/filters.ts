import type Database from 'better-sqlite3';

interface FilterSchemaError extends Error {
  code?: string;
  statusCode?: number;
}

export interface FilterRow {
  id: number;
  name: string;
  description: string | null;
  trigger_source: string;
  rule_type: string;
  rule_payload: string;
  action_type: string;
  action_payload: string | null;
  script_runtime: string;
  target_path: string | null;
  is_built_in: number;
  notify_on_match: number;
  notify_webhook_url: string | null;
  notify_slack: number;
  notify_slack_token: string | null;
  notify_slack_channel: string | null;
  override_notifications: number;
  instance_id: number | null;
  enabled: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CreateFilterInput {
  name: string;
  description?: string;
  triggerSource: string;
  ruleType: string;
  rulePayload: string;
  actionType: string;
  actionPayload?: string;
  scriptRuntime?: string;
  targetPath?: string;
  notifyOnMatch?: boolean;
  notifyWebhookUrl?: string;
  notifySlack?: boolean;
  notifySlackToken?: string;
  notifySlackChannel?: string;
  overrideNotifications?: boolean;
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
  scriptRuntime?: string;
  targetPath?: string;
  notifyOnMatch?: boolean;
  notifyWebhookUrl?: string;
  notifySlack?: boolean;
  notifySlackToken?: string;
  notifySlackChannel?: string;
  overrideNotifications?: boolean;
  instanceId?: number;
  enabled?: boolean;
  sortOrder?: number;
}

export function getAllFilters(db: Database.Database): FilterRow[] {
  return db
    .prepare<[], FilterRow>('SELECT * FROM filters ORDER BY sort_order ASC, created_at DESC')
    .all();
}

export function getFilterById(db: Database.Database, id: number): FilterRow | null {
  const result = db.prepare<[number], FilterRow>('SELECT * FROM filters WHERE id = ?').get(id);
  return result || null;
}

function arrInstanceExists(db: Database.Database, id: number): boolean {
  const result = db.prepare<[number], { id: number }>('SELECT id FROM arr_instances WHERE id = ?').get(id);
  return !!result;
}

export function createFilter(db: Database.Database, input: CreateFilterInput): FilterRow {
  const result = db
    .prepare(
      `INSERT INTO filters (
         name, description, trigger_source, rule_type, rule_payload,
         action_type, action_payload, script_runtime, target_path,
         notify_on_match, notify_webhook_url, notify_slack,
         notify_slack_token, notify_slack_channel,
         override_notifications,
         instance_id,
         enabled, sort_order, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    )
    .run(
      input.name,
      input.description || null,
      input.triggerSource,
      input.ruleType,
      input.rulePayload,
      input.actionType,
      input.actionPayload || null,
      input.scriptRuntime || 'shell',
      input.targetPath || null,
      input.notifyOnMatch ? 1 : 0,
      input.notifyWebhookUrl || null,
      input.notifySlack ? 1 : 0,
      input.notifySlackToken || null,
      input.notifySlackChannel || null,
      input.overrideNotifications ? 1 : 0,
      input.instanceId || null,
      input.enabled === false ? 0 : 1,
      input.sortOrder || 0,
    );

  const newRow = getFilterById(db, result.lastInsertRowid as number);
  if (!newRow) throw new Error('Failed to retrieve created filter');
  return newRow;
}

/** Resolve an optional input field, falling back to the current value. */
function resolve<T>(inputValue: T | undefined, currentValue: T): T {
  return inputValue ?? currentValue;
}

/** Resolve an optional boolean input to a 0/1 integer for SQLite. */
function resolveBool(inputValue: boolean | undefined, currentValue: number): number {
  if (inputValue === undefined) return currentValue;
  return inputValue ? 1 : 0;
}

function resolveInstanceId(
  db: Database.Database,
  input: UpdateFilterInput,
  current: FilterRow,
): number | null {
  const requestedInstanceId = resolve(input.instanceId, current.instance_id);
  const instanceId = requestedInstanceId ?? null;

  if (instanceId !== null && !arrInstanceExists(db, instanceId)) {
    if (input.instanceId !== undefined) {
      const error = new Error(`Instance with id ${instanceId} not found`) as FilterSchemaError;
      error.code = 'FILTER_INSTANCE_NOT_FOUND';
      error.statusCode = 400;
      throw error;
    }
    return null;
  }

  return instanceId;
}

interface ResolvedFilterFields {
  name: string;
  description: string | null;
  triggerSource: string;
  ruleType: string;
  rulePayload: string;
  actionType: string;
  actionPayload: string | null;
  scriptRuntime: string;
  targetPath: string | null;
  notifyOnMatch: number;
  notifyWebhookUrl: string | null;
  notifySlack: number;
  notifySlackToken: string | null;
  notifySlackChannel: string | null;
  overrideNotifications: number;
  instanceId: number | null;
  enabled: number;
  sortOrder: number;
}

function resolveFilterFields(
  db: Database.Database,
  input: UpdateFilterInput,
  current: FilterRow,
): ResolvedFilterFields {
  return {
    name: input.name ?? current.name,
    description: resolve(input.description, current.description),
    triggerSource: input.triggerSource ?? current.trigger_source,
    ruleType: input.ruleType ?? current.rule_type,
    rulePayload: input.rulePayload ?? current.rule_payload,
    actionType: input.actionType ?? current.action_type,
    actionPayload: resolve(input.actionPayload, current.action_payload),
    scriptRuntime: input.scriptRuntime ?? current.script_runtime,
    targetPath: resolve(input.targetPath, current.target_path),
    notifyOnMatch: resolveBool(input.notifyOnMatch, current.notify_on_match),
    notifyWebhookUrl: resolve(input.notifyWebhookUrl, current.notify_webhook_url),
    notifySlack: resolveBool(input.notifySlack, current.notify_slack),
    notifySlackToken: resolve(input.notifySlackToken, current.notify_slack_token),
    notifySlackChannel: resolve(input.notifySlackChannel, current.notify_slack_channel),
    overrideNotifications: resolveBool(input.overrideNotifications, current.override_notifications),
    instanceId: resolveInstanceId(db, input, current),
    enabled: resolveBool(input.enabled, current.enabled),
    sortOrder: input.sortOrder ?? current.sort_order,
  };
}

export function updateFilter(
  db: Database.Database,
  id: number,
  input: UpdateFilterInput,
): FilterRow {
  const current = getFilterById(db, id);
  if (!current) throw new Error(`Filter with id ${id} not found`);

  const fields = resolveFilterFields(db, input, current);

  db.prepare(
    `UPDATE filters
     SET name = ?, description = ?, trigger_source = ?, rule_type = ?, rule_payload = ?,
         action_type = ?, action_payload = ?, script_runtime = ?, target_path = ?,
         notify_on_match = ?, notify_webhook_url = ?, notify_slack = ?,
         notify_slack_token = ?, notify_slack_channel = ?, override_notifications = ?,
         instance_id = ?, enabled = ?, sort_order = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(
    fields.name,
    fields.description || null,
    fields.triggerSource,
    fields.ruleType,
    fields.rulePayload,
    fields.actionType,
    fields.actionPayload || null,
    fields.scriptRuntime,
    fields.targetPath || null,
    fields.notifyOnMatch,
    fields.notifyWebhookUrl || null,
    fields.notifySlack,
    fields.notifySlackToken || null,
    fields.notifySlackChannel || null,
    fields.overrideNotifications,
    fields.instanceId,
    fields.enabled,
    fields.sortOrder,
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
