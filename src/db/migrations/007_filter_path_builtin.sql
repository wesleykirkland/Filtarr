-- Add target_path (which directory this filter scans) and is_built_in flag
ALTER TABLE filters ADD COLUMN target_path TEXT;
ALTER TABLE filters ADD COLUMN is_built_in INTEGER NOT NULL DEFAULT 0;

-- Change jobs payload to store filter_id (as JSON {filterId:N} for backward compat)
-- No schema change needed — payload already exists as TEXT

-- Seed the built-in EXE blocklist filter (idempotent via WHERE NOT EXISTS)
INSERT INTO filters (name, description, trigger_source, rule_type, rule_payload, action_type, action_payload, enabled, sort_order, is_built_in, created_at, updated_at)
SELECT
  'Detect and Blocklist EXE Files',
  'Scans the target path for .exe files and blocklists the parent release in all connected Arr instances.',
  'watcher',
  'extension',
  'exe',
  'blocklist',
  NULL,
  1,
  0,
  1,
  datetime('now'),
  datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM filters WHERE is_built_in = 1 AND rule_payload = 'exe' AND action_type = 'blocklist');
