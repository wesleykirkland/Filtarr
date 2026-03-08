-- Unified notifications and per-filter paths
ALTER TABLE filters ADD COLUMN notify_slack_enabled INTEGER DEFAULT 0;
ALTER TABLE filters ADD COLUMN notify_slack_token TEXT;
ALTER TABLE filters ADD COLUMN notify_slack_channel TEXT;

-- Update settings to support concurrent types
INSERT OR IGNORE INTO settings (key, value) VALUES ('notify_global_webhook_enabled', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('notify_global_slack_enabled', '0');

-- Optional: Clean up old settings if they exist
-- DELETE FROM settings WHERE key = 'notify_global_enabled'; 
-- Actually, let's keep it but migrate it if possible, or just ignore. 
-- The app will use the new keys.

-- Delete global directories table as they are now per-filter
DROP TABLE IF EXISTS directories;
