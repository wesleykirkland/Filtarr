import type Database from 'better-sqlite3';

export interface EventRow {
  id: number;
  type: string;
  source: string;
  message: string;
  details: string | null;
  created_at: string;
}

export type EventDetails = Record<string, unknown> | null;

export interface EventResponse {
  id: number;
  type: string;
  source: string;
  message: string;
  details: EventDetails;
  createdAt: string;
}

export interface CreateEventInput {
  type: string;
  source: string;
  message: string;
  details?: Record<string, unknown> | null;
}

export interface ListEventsOptions {
  type?: string;
  source?: string;
  limit?: number;
}

function serializeDetails(details?: Record<string, unknown> | null): string | null {
  if (!details || Object.keys(details).length === 0) return null;
  return JSON.stringify(details);
}

function parseDetails(details: string | null): EventDetails {
  if (!details) return null;

  try {
    const parsed = JSON.parse(details);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { raw: details };
  }
}

function toEventResponse(row: EventRow): EventResponse {
  return {
    id: row.id,
    type: row.type,
    source: row.source,
    message: row.message,
    details: parseDetails(row.details),
    createdAt: row.created_at,
  };
}

function getEventById(db: Database.Database, id: number): EventRow | null {
  return db.prepare<[number], EventRow>('SELECT * FROM events WHERE id = ?').get(id) || null;
}

function normalizeLimit(limit?: number): number {
  if (!limit || Number.isNaN(limit)) return 50;
  return Math.min(Math.max(limit, 1), 200);
}

export function createEvent(db: Database.Database, input: CreateEventInput): EventResponse {
  const result = db
    .prepare<[string, string, string, string | null]>(
      `INSERT INTO events (type, source, message, details)
       VALUES (?, ?, ?, ?)`,
    )
    .run(input.type, input.source, input.message, serializeDetails(input.details));

  const row = getEventById(db, Number(result.lastInsertRowid));
  if (!row) throw new Error('Failed to retrieve created event');
  return toEventResponse(row);
}

export function listEvents(
  db: Database.Database,
  options: ListEventsOptions = {},
): EventResponse[] {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (options.type) {
    clauses.push('type = ?');
    params.push(options.type);
  }

  if (options.source) {
    clauses.push('source = ?');
    params.push(options.source);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const query = `SELECT * FROM events ${where} ORDER BY datetime(created_at) DESC, id DESC LIMIT ?`;

  const rows = db.prepare(query).all(...params, normalizeLimit(options.limit)) as EventRow[];
  return rows.map(toEventResponse);
}