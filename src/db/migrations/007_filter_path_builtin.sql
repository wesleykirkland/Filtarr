-- Add target_path (which directory this filter scans) and is_built_in flag
ALTER TABLE filters ADD COLUMN target_path TEXT;
ALTER TABLE filters ADD COLUMN is_built_in INTEGER NOT NULL DEFAULT 0;

-- Change jobs payload to store filter_id (as JSON {filterId:N} for backward compat)
-- No schema change needed — payload already exists as TEXT

-- Built-in filter presets are available in application code, but are not
-- auto-seeded into the database during migrations.
