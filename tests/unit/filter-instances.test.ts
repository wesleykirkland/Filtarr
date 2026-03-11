import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getFilterInstanceIds,
  getFilterInstances,
  setFilterInstances,
} from '../../src/db/schemas/filterInstances.js';

describe('filter instance links', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE arr_instances (id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL);
      CREATE TABLE filter_instances (filter_id INTEGER NOT NULL, instance_id INTEGER NOT NULL, UNIQUE(filter_id, instance_id));
    `);
    db.prepare('INSERT INTO arr_instances (id, name, type) VALUES (?, ?, ?)').run(1, 'Main Sonarr', 'sonarr');
    db.prepare('INSERT INTO arr_instances (id, name, type) VALUES (?, ?, ?)').run(2, 'Backup Radarr', 'radarr');
  });

  afterEach(() => {
    db.close();
  });

  it('lists linked instances and their ids', () => {
    setFilterInstances(db, 7, [1, 2]);

    expect(getFilterInstances(db, 7)).toEqual([
      { id: 1, name: 'Main Sonarr', type: 'sonarr' },
      { id: 2, name: 'Backup Radarr', type: 'radarr' },
    ]);
    expect(getFilterInstanceIds(db, 7)).toEqual([1, 2]);
  });

  it('replaces existing links and clears them when given an empty array', () => {
    setFilterInstances(db, 7, [1, 2]);
    setFilterInstances(db, 7, [2]);
    expect(getFilterInstanceIds(db, 7)).toEqual([2]);

    setFilterInstances(db, 7, []);
    expect(getFilterInstances(db, 7)).toEqual([]);
    expect(getFilterInstanceIds(db, 7)).toEqual([]);
  });
});