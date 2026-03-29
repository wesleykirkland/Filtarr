import type Database from 'better-sqlite3';

export interface JobRow {
  id: number;
  name: string;
  description: string | null;
  schedule: string;
  type: string;
  payload: string | null;
  enabled: number;
  last_run: string | null;
  next_run: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateJobInput {
  name: string;
  description?: string;
  schedule: string;
  type: string;
  payload?: string;
  enabled?: boolean;
}

export interface UpdateJobInput {
  name?: string;
  description?: string;
  schedule?: string;
  type?: string;
  payload?: string;
  enabled?: boolean;
  lastRun?: string;
  nextRun?: string;
}

export function getAllJobs(db: Database.Database): JobRow[] {
  return db.prepare<[], JobRow>('SELECT * FROM jobs ORDER BY created_at DESC').all();
}

export function getJobById(db: Database.Database, id: number): JobRow | null {
  const result = db.prepare<[number], JobRow>('SELECT * FROM jobs WHERE id = ?').get(id);
  return result || null;
}

export function createJob(db: Database.Database, input: CreateJobInput): JobRow {
  const result = db
    .prepare<[string, string | null, string, string, string | null, number]>(
      `INSERT INTO jobs (
         name, description, schedule, type, payload, enabled, created_at, updated_at
       ) 
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    )
    .run(
      input.name,
      input.description || null,
      input.schedule,
      input.type,
      input.payload || null,
      input.enabled === false ? 0 : 1,
    );

  const newRow = getJobById(db, result.lastInsertRowid as number);
  if (!newRow) throw new Error('Failed to retrieve created job');
  return newRow;
}

export function updateJob(db: Database.Database, id: number, input: UpdateJobInput): JobRow {
  const current = getJobById(db, id);
  if (!current) throw new Error(`Job with id ${id} not found`);

  const name = input.name ?? current.name;
  const description = input.description ?? current.description;
  const schedule = input.schedule ?? current.schedule;
  const type = input.type ?? current.type;
  const payload = input.payload ?? current.payload;
  const enabled = input.enabled != null ? (input.enabled ? 1 : 0) : current.enabled;
  const lastRun = input.lastRun ?? current.last_run;
  const nextRun = input.nextRun ?? current.next_run;

  db.prepare<
    [
      string,
      string | null,
      string,
      string,
      string | null,
      number,
      string | null,
      string | null,
      number,
    ]
  >(
    `UPDATE jobs 
     SET name = ?, description = ?, schedule = ?, type = ?, payload = ?,
         enabled = ?, last_run = ?, next_run = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(
    name,
    description || null,
    schedule,
    type,
    payload || null,
    enabled,
    lastRun || null,
    nextRun || null,
    id,
  );

  const updatedRow = getJobById(db, id);
  if (!updatedRow) throw new Error('Failed to retrieve updated job');
  return updatedRow;
}

export function deleteJob(db: Database.Database, id: number): boolean {
  const result = db.prepare<[number]>('DELETE FROM jobs WHERE id = ?').run(id);
  return result.changes > 0;
}
