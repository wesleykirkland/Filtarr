-- Migration 001: Create arr_instances table
-- Stores Arr application instance configurations with encrypted API keys.

CREATE TABLE IF NOT EXISTS arr_instances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('sonarr', 'radarr', 'lidarr', 'readarr')),
  url TEXT NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  timeout INTEGER NOT NULL DEFAULT 30000,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Ensure unique name per type
CREATE UNIQUE INDEX IF NOT EXISTS idx_arr_instances_name_type ON arr_instances(name, type);
