-- Per-filter notification: fire a webhook when the filter matches a file
ALTER TABLE filters ADD COLUMN notify_on_match INTEGER NOT NULL DEFAULT 0;
ALTER TABLE filters ADD COLUMN notify_webhook_url TEXT;
