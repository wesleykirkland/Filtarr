import { logger } from '../lib/logger.js';
import type Database from 'better-sqlite3';

export interface NotificationPayload {
    event: 'filter_match' | 'test';
    filter?: {
        id: number;
        name: string;
    };
    file?: {
        path: string;
        name: string;
        size: number;
    };
    message?: string;
    timestamp: string;
}

export class NotificationService {
    private db: Database.Database;

    constructor(db: Database.Database) {
        this.db = db;
    }

    private getGlobalSettings() {
        const rows = this.db.prepare("SELECT key, value FROM settings WHERE key LIKE 'notify_global_%'").all() as { key: string; value: string }[];
        const settings: Record<string, string> = {};
        for (const row of rows) {
            settings[row.key] = row.value;
        }
        return {
            enabled: settings['notify_global_enabled'] === '1',
            type: (settings['notify_global_type'] || 'webhook') as 'webhook' | 'slack',
            url: settings['notify_global_url'] || '',
            slackToken: settings['notify_global_slack_token'] || '',
            slackChannel: settings['notify_global_slack_channel'] || '',
        };
    }

    public async sendNotification(payload: NotificationPayload, filterOverride?: { enabled: boolean, url?: string }) {
        const global = this.getGlobalSettings();

        // Determine if we should notify
        const shouldNotify = filterOverride ? filterOverride.enabled : global.enabled;
        if (!shouldNotify) return;

        // Determine URL/Target
        let targetUrl = filterOverride?.url || global.url;
        const type = global.type;

        if (type === 'slack' && global.slackToken && global.slackChannel && !filterOverride?.url) {
            await this.sendSlackNotification(global.slackToken, global.slackChannel, payload);
        } else if (targetUrl) {
            await this.sendWebhookNotification(targetUrl, payload);
        } else {
            logger.warn('Notification triggered but no valid target (URL or Slack) configured');
        }
    }

    private async sendWebhookNotification(url: string, payload: NotificationPayload) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                logger.warn({ url, status: response.status }, 'Webhook notification failed');
            }
        } catch (err: any) {
            logger.error({ url, err: err.message }, 'Error sending webhook notification');
        }
    }

    private async sendSlackNotification(token: string, channel: string, payload: NotificationPayload) {
        try {
            const text = payload.event === 'test'
                ? `🔔 *Filtarr Test Notification*\n${payload.message}`
                : `🎯 *Filter Match: ${payload.filter?.name}*\n` +
                `*File:* \`${payload.file?.name}\`\n` +
                `*Path:* \`${payload.file?.path}\`\n` +
                `*Size:* ${this.formatSize(payload.file?.size || 0)}`;

            const response = await fetch('https://slack.com/api/chat.postMessage', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    channel: channel,
                    text: text,
                    blocks: [
                        {
                            type: 'section',
                            text: { type: 'mrkdwn', text }
                        }
                    ]
                }),
            });

            const data = await response.json() as any;
            if (!data.ok) {
                logger.warn({ channel, error: data.error }, 'Slack notification failed');
            }
        } catch (err: any) {
            logger.error({ channel, err: err.message }, 'Error sending Slack notification');
        }
    }

    private formatSize(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}
