-- Migration 006: Wave 2 Core Features (Directories, Filters, Jobs)

-- Directories to watch via Chokidar
CREATE TABLE IF NOT EXISTS directories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  recursive INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Filters to apply to watched files
CREATE TABLE IF NOT EXISTS filters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  trigger_source TEXT NOT NULL, -- e.g., 'watcher', 'cron', 'manual'
  rule_type TEXT NOT NULL, -- e.g., 'regex', 'extension', 'size', 'script'
  rule_payload TEXT NOT NULL, -- JSON config for the rule
  action_type TEXT NOT NULL, -- e.g., 'blocklist', 'delete', 'move', 'script', 'notify'
  action_payload TEXT, -- JSON config for the action
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Scheduled tasks (Cron jobs)
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  schedule TEXT NOT NULL, -- Cron expression
  type TEXT NOT NULL, -- e.g., 'custom_script', 'built_in'
  payload TEXT, -- The script code or config
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run TEXT,
  next_run TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Links between directories and filters (many-to-many, optional)
-- If we want generic global filters, maybe we don't need this, but it's good for directory-specific rules.
CREATE TABLE IF NOT EXISTS directory_filters (
  directory_id INTEGER NOT NULL,
  filter_id INTEGER NOT NULL,
  PRIMARY KEY (directory_id, filter_id),
  FOREIGN KEY (directory_id) REFERENCES directories(id) ON DELETE CASCADE,
  FOREIGN KEY (filter_id) REFERENCES filters(id) ON DELETE CASCADE
);
