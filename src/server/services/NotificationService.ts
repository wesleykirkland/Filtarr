import type Database from 'better-sqlite3';
import type { FilterRow } from '../../db/schemas/filters.js';
import { logger } from '../lib/logger.js';
import type { FileEvent } from './filterEngine.js';

interface NotificationSettings {
  slackEnabled: boolean;
  webhookEnabled: boolean;
  defaultWebhookUrl: string;
  defaultSlackToken: string;
  defaultSlackChannel: string;
}

interface NotificationTargets {
  webhookUrl?: string;
  slackToken?: string;
  slackChannel?: string;
}

interface SettingRow {
  value: string;
}

interface SlackApiResponse {
  ok?: boolean;
}

export class NotificationService {
  constructor(private readonly db: Database.Database) {}

  public async notifyFilterMatch(filter: FilterRow, file: FileEvent) {
    const settings = this.getNotificationSettings();
    const targets = this.resolveNotificationTargets(filter, settings);
    const deliveries: Promise<void>[] = [];

    if (settings.webhookEnabled && targets.webhookUrl) {
      deliveries.push(this.sendWebhookNotification(filter, file, targets.webhookUrl));
    }

    if (settings.slackEnabled && targets.slackToken && targets.slackChannel) {
      deliveries.push(this.sendSlackNotification(filter, file, targets.slackToken, targets.slackChannel));
    } else if (settings.slackEnabled) {
      this.logSlackConfigurationWarning(filter, targets);
    }

    if (!deliveries.length) return;

    await Promise.allSettled(deliveries);
  }

  private getNotificationSettings(): NotificationSettings {
    return {
      slackEnabled: this.getBooleanSetting('slack_enabled'),
      webhookEnabled: this.getBooleanSetting('webhook_enabled', true),
      defaultWebhookUrl: this.getStringSetting('default_webhook_url'),
      defaultSlackToken: this.getStringSetting('default_slack_token'),
      defaultSlackChannel: this.getStringSetting('default_slack_channel'),
    };
  }

  private getStringSetting(key: string, defaultValue = ''): string {
    return (
      this.db.prepare<[string], SettingRow>('SELECT value FROM settings WHERE key = ?').get(key)
        ?.value || defaultValue
    );
  }

  private getBooleanSetting(key: string, defaultValue = false): boolean {
    const result = this.db
      .prepare<[string], SettingRow>('SELECT value FROM settings WHERE key = ?')
      .get(key);
    if (!result) return defaultValue;
    return result.value === '1';
  }

  private trimToUndefined(value: string | null | undefined): string | undefined {
    const trimmed = value?.trim() ?? '';
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private resolveNotificationTargets(
    filter: FilterRow,
    settings: NotificationSettings,
  ): NotificationTargets {
    if (filter.override_notifications === 1) {
      return {
        webhookUrl: filter.notify_on_match
          ? this.trimToUndefined(filter.notify_webhook_url)
          : undefined,
        slackToken: filter.notify_slack ? this.trimToUndefined(filter.notify_slack_token) : undefined,
        slackChannel: filter.notify_slack
          ? this.trimToUndefined(filter.notify_slack_channel)
          : undefined,
      };
    }

    return {
      webhookUrl: this.trimToUndefined(settings.defaultWebhookUrl),
      slackToken: this.trimToUndefined(settings.defaultSlackToken),
      slackChannel: this.trimToUndefined(settings.defaultSlackChannel),
    };
  }

  private logSlackConfigurationWarning(filter: FilterRow, targets: NotificationTargets) {
    if (filter.override_notifications === 1) {
      if (!filter.notify_slack) return;

      logger.warn(
        { filterId: filter.id },
        'Slack notification override is enabled but no per-filter token/channel is configured',
      );
      return;
    }

    if (!targets.slackToken && !targets.slackChannel) return;

    logger.warn(
      { filterId: filter.id },
      'Filter inherits Slack notifications but the default token/channel is incomplete',
    );
  }

  private buildPayload(filter: FilterRow, file: FileEvent) {
    return {
      event: 'filter_match',
      filter: {
        id: filter.id,
        name: filter.name,
      },
      file: {
        path: file.path,
        name: file.name,
        size: file.size,
      },
      timestamp: new Date().toISOString(),
    };
  }

  private buildSlackText(filter: FilterRow, file: FileEvent): string {
    return [
      `Filtarr filter match: ${filter.name}`,
      `File: ${file.name}`,
      `Path: ${file.path}`,
      `Size: ${file.size} bytes`,
    ].join('\n');
  }

  private async sendWebhookNotification(filter: FilterRow, file: FileEvent, webhookUrl: string) {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.buildPayload(filter, file)),
    });

    if (!response.ok) {
      logger.warn(
        { filterId: filter.id, status: response.status },
        'Webhook notification failed',
      );
      return;
    }

    logger.debug({ filterId: filter.id }, 'Webhook notification sent');
  }

  private async sendSlackNotification(
    filter: FilterRow,
    file: FileEvent,
    token: string,
    channel: string,
  ) {
    const text = this.buildSlackText(filter, file);

    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ channel, text }),
    });

    const body = (await response.json().catch(() => null)) as SlackApiResponse | null;
    if (!response.ok || !body?.ok) {
      logger.warn(
        { filterId: filter.id, status: response.status, body },
        'Slack notification failed',
      );
      return;
    }

    logger.debug({ filterId: filter.id, channel }, 'Slack notification sent');
  }
}
