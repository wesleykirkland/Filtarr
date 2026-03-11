-- Migration 012: Per-filter Slack notifications and global notification settings
-- This migration extends filter notifications to support Slack and webhook independently.

-- Add per-filter Slack notification toggle
-- Filters can now enable Slack notifications separately from webhook notifications.
-- When notify_slack=1, the filter will send to the global Slack webhook URL from settings.
ALTER TABLE filters ADD COLUMN notify_slack INTEGER NOT NULL DEFAULT 0;

-- Global notification settings are stored in the existing `settings` table:
--   - 'slack_webhook_url': The global Slack webhook URL
--   - 'slack_enabled': Whether Slack notifications are globally enabled ('1' or '0')
--   - 'webhook_enabled': Whether webhook notifications are globally enabled ('1' or '0')
-- These are inserted dynamically via the settings API, so no seeding is needed here.

