import type Database from 'better-sqlite3';

export interface DirectoryRow {
  id: number;
  path: string;
  recursive: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface CreateDirectoryInput {
  path: string;
  recursive?: boolean;
  enabled?: boolean;
}

export interface UpdateDirectoryInput {
  path?: string;
  recursive?: boolean;
  enabled?: boolean;
}

export function getAllDirectories(db: Database.Database): DirectoryRow[] {
  return db.prepare<[], DirectoryRow>('SELECT * FROM directories ORDER BY created_at DESC').all();
}

export function getDirectoryById(db: Database.Database, id: number): DirectoryRow | null {
  const result = db
    .prepare<[number], DirectoryRow>('SELECT * FROM directories WHERE id = ?')
    .get(id);
  return result || null;
}

export function createDirectory(db: Database.Database, input: CreateDirectoryInput): DirectoryRow {
  const result = db
    .prepare<[string, number, number]>(
      `INSERT INTO directories (path, recursive, enabled, created_at, updated_at) 
       VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
    )
    .run(input.path, input.recursive ? 1 : 0, input.enabled === false ? 0 : 1);

  const newRow = getDirectoryById(db, result.lastInsertRowid as number);
  if (!newRow) throw new Error('Failed to retrieve created directory');
  return newRow;
}

export function updateDirectory(
  db: Database.Database,
  id: number,
  input: UpdateDirectoryInput,
): DirectoryRow {
  const current = getDirectoryById(db, id);
  if (!current) throw new Error(`Directory with id ${id} not found`);

  const path = input.path ?? current.path;
  let recursive = current.recursive;
  if (input.recursive !== undefined) {
    recursive = input.recursive ? 1 : 0;
  }
  let enabled = current.enabled;
  if (input.enabled !== undefined) {
    enabled = input.enabled ? 1 : 0;
  }

  db.prepare<[string, number, number, number]>(
    `UPDATE directories 
     SET path = ?, recursive = ?, enabled = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(path, recursive, enabled, id);

  const updatedRow = getDirectoryById(db, id);
  if (!updatedRow) throw new Error('Failed to retrieve updated directory');
  return updatedRow;
}

export function deleteDirectory(db: Database.Database, id: number): boolean {
  const result = db.prepare<[number]>('DELETE FROM directories WHERE id = ?').run(id);
  return result.changes > 0;
}
