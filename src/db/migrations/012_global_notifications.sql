-- Global notification settings
INSERT OR IGNORE INTO settings (key, value) VALUES ('notify_global_enabled', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('notify_global_type', 'webhook'); -- slack or webhook
INSERT OR IGNORE INTO settings (key, value) VALUES ('notify_global_url', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('notify_global_slack_channel', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('notify_global_slack_token', '');
