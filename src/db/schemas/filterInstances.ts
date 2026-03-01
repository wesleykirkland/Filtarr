import type Database from 'better-sqlite3';

interface LinkedInstance {
  id: number;
  name: string;
  type: string;
}

/**
 * Get all instances linked to a given filter.
 */
export function getFilterInstances(db: Database.Database, filterId: number): LinkedInstance[] {
  return db
    .prepare<[number], LinkedInstance>(
      `SELECT i.id, i.name, i.type FROM arr_instances i
             INNER JOIN filter_instances fi ON fi.instance_id = i.id
             WHERE fi.filter_id = ?`,
    )
    .all(filterId);
}

/**
 * Get instance IDs linked to a given filter.
 */
export function getFilterInstanceIds(db: Database.Database, filterId: number): number[] {
  const rows = db
    .prepare<
      [number],
      { instance_id: number }
    >('SELECT instance_id FROM filter_instances WHERE filter_id = ?')
    .all(filterId);
  return rows.map((r) => r.instance_id);
}

/**
 * Replace all linked instances for a filter in a single transaction.
 * Passing an empty array clears all links.
 */
export function setFilterInstances(
  db: Database.Database,
  filterId: number,
  instanceIds: number[],
): void {
  const doReplace = db.transaction(() => {
    db.prepare('DELETE FROM filter_instances WHERE filter_id = ?').run(filterId);
    const insert = db.prepare<[number, number]>(
      'INSERT OR IGNORE INTO filter_instances (filter_id, instance_id) VALUES (?, ?)',
    );
    for (const instanceId of instanceIds) {
      insert.run(filterId, instanceId);
    }
  });
  doReplace();
}
