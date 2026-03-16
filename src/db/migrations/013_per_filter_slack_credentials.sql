-- Migration 013: Per-filter Slack credentials (token and channel)
-- This migration aligns the notification contract to the user's original request:
-- Each filter can have its own Slack bot token and channel, rather than relying
-- on a global Slack webhook URL from settings.

-- Add per-filter Slack bot token
-- Stores the Slack Bot OAuth token for this filter's notifications.
ALTER TABLE filters ADD COLUMN notify_slack_token TEXT;

-- Add per-filter Slack channel
-- The channel ID or name (e.g., #alerts or C01234567) where notifications are posted.
ALTER TABLE filters ADD COLUMN notify_slack_channel TEXT;

-- Note: The existing `notify_slack` column (INTEGER) remains as the enable flag.
-- Global settings `slack_enabled` and `webhook_enabled` remain as independent master switches.
-- The global `slack_webhook_url` setting is retained for backward compatibility but
-- per-filter token/channel takes precedence when populated.

