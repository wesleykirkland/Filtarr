-- Migration 011: Transition Filters to 1:1 Instance relationship
-- 1. Add instance_id column to filters
ALTER TABLE filters ADD COLUMN instance_id INTEGER REFERENCES arr_instances(id) ON DELETE CASCADE;

-- 2. Populate filters.instance_id from filter_instances
-- If a filter was linked to multiple instances, we'll create duplicates of the filter for each additional instance.
-- For the first instance for each filter, update the existing row.
UPDATE filters
SET instance_id = (
  SELECT instance_id 
  FROM filter_instances 
  WHERE filter_id = filters.id 
  LIMIT 1
);

-- 3. For filters that had 2+ instances, duplicate them
INSERT INTO filters (
  name, description, trigger_source, rule_type, rule_payload, action_type, action_payload, 
  target_path, is_built_in, notify_on_match, notify_webhook_url, enabled, sort_order, instance_id, created_at, updated_at
)
SELECT 
  f.name || ' (' || i.name || ')', 
  f.description, f.trigger_source, f.rule_type, f.rule_payload, f.action_type, f.action_payload, 
  f.target_path, f.is_built_in, f.notify_on_match, f.notify_webhook_url, f.enabled, f.sort_order,
  fi.instance_id, datetime('now'), datetime('now')
FROM filter_instances fi
JOIN filters f ON f.id = fi.filter_id
JOIN arr_instances i ON i.id = fi.instance_id
WHERE fi.instance_id != (SELECT instance_id FROM filter_instances WHERE filter_id = f.id LIMIT 1);

-- 4. Drop the many-to-many table
DROP TABLE IF EXISTS filter_instances;
