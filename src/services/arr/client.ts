/**
 * Base Arr API client with configurable timeout, automatic retry with
 * exponential backoff, and typed responses.
 *
 * All Arr apps (Sonarr, Radarr, Lidarr, Readarr) share the same v3 API
 * structure. This base client handles authentication, retries, and error
 * mapping. App-specific clients extend this class.
 */

import {
  type ArrClientOptions,
  ArrApiError,
  ArrConnectionError,
  type SystemStatusResource,
  type HealthResource,
  type QueueResource,
  type PagingResource,
  type BlocklistResource,
  type CommandResource,
  type CommandBody,
  type DeleteQueueOptions,
  type ConnectionTestResult,
} from './types.js';

const DEFAULT_TIMEOUT = 30_000; // 30 seconds
const DEFAULT_MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 1000; // 1 second
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

export class ArrClient {
  protected readonly baseUrl: string;
  protected readonly apiKey: string;
  protected readonly timeout: number;
  protected readonly maxRetries: number;

  constructor(options: ArrClientOptions) {
    // Normalize URL: remove trailing slash
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  // ── Core HTTP Methods ───────────────────────────────────────────────────

  protected async get<T>(path: string, params?: Record<string, string | number | boolean>): Promise<T> {
    const url = this.buildUrl(path, params);
    return this.requestWithRetry<T>('GET', url);
  }

  protected async post<T>(path: string, body?: unknown): Promise<T> {
    const url = this.buildUrl(path);
    return this.requestWithRetry<T>('POST', url, body);
  }

  protected async put<T>(path: string, body?: unknown): Promise<T> {
    const url = this.buildUrl(path);
    return this.requestWithRetry<T>('PUT', url, body);
  }

  protected async delete<T = void>(path: string, params?: Record<string, string | number | boolean>): Promise<T> {
    const url = this.buildUrl(path, params);
    return this.requestWithRetry<T>('DELETE', url);
  }

  // ── Shared Endpoints (all Arr apps) ─────────────────────────────────────

  /** Test connection by fetching system status */
  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const status = await this.getSystemStatus();
      return {
        success: true,
        appName: status.appName,
        appVersion: status.version,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /** GET /api/v3/system/status */
  async getSystemStatus(): Promise<SystemStatusResource> {
    return this.get<SystemStatusResource>('/api/v3/system/status');
  }

  /** GET /api/v3/health */
  async getHealth(): Promise<HealthResource[]> {
    return this.get<HealthResource[]>('/api/v3/health');
  }

  /** GET /api/v3/queue */
  async getQueue(page = 1, pageSize = 20): Promise<PagingResource<QueueResource>> {
    return this.get<PagingResource<QueueResource>>('/api/v3/queue', {
      page,
      pageSize,
      sortKey: 'timeleft',
      sortDirection: 'ascending',
    });
  }

  /** DELETE /api/v3/queue/{id} with options */
  async deleteQueueItem(id: number, options: DeleteQueueOptions = {}): Promise<void> {
    const params: Record<string, string | number | boolean> = {};
    if (options.removeFromClient !== undefined) params['removeFromClient'] = options.removeFromClient;
    if (options.blocklist !== undefined) params['blocklist'] = options.blocklist;
    if (options.skipRedownload !== undefined) params['skipRedownload'] = options.skipRedownload;
    if (options.changeCategory !== undefined) params['changeCategory'] = options.changeCategory;
    await this.delete(`/api/v3/queue/${id}`, params);
  }

  /** Convenience: remove from queue + add to blocklist */
  async blocklistAndRemove(queueId: number): Promise<void> {
    await this.deleteQueueItem(queueId, {
      removeFromClient: true,
      blocklist: true,
    });
  }

  /** GET /api/v3/blocklist */
  async getBlocklist(page = 1, pageSize = 20): Promise<PagingResource<BlocklistResource>> {
    return this.get<PagingResource<BlocklistResource>>('/api/v3/blocklist', {
      page,
      pageSize,
      sortKey: 'date',
      sortDirection: 'descending',
    });
  }

  /** POST /api/v3/command */
  async executeCommand(body: CommandBody): Promise<CommandResource> {
    return this.post<CommandResource>('/api/v3/command', body);
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private buildUrl(path: string, params?: Record<string, string | number | boolean>): string {
    const url = new URL(path, this.baseUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private async requestWithRetry<T>(method: string, url: string, body?: unknown): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.request<T>(method, url, body);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on client errors (4xx) except specific retryable ones
        if (error instanceof ArrApiError && !RETRYABLE_STATUS_CODES.has(error.statusCode)) {
          throw error;
        }

        // Don't retry on last attempt
        if (attempt === this.maxRetries) {
          break;
        }

        // Exponential backoff with jitter
        const delay = RETRY_BASE_DELAY * Math.pow(2, attempt) + Math.random() * 500;
        await this.sleep(delay);
      }
    }

    throw lastError!;
  }

  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const headers: Record<string, string> = {
        'X-Api-Key': this.apiKey,
        'Accept': 'application/json',
      };

      const init: RequestInit = {
        method,
        headers,
        signal: controller.signal,
      };

      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }

      const response = await fetch(url, init);

      if (!response.ok) {
        const responseBody = await response.text().catch(() => '');
        throw new ArrApiError(
          `Arr API error: ${response.status} ${response.statusText}`,
          response.status,
          url,
          responseBody,
        );
      }

      // Handle 204 No Content (e.g., DELETE responses)
      if (response.status === 204) {
        return undefined as T;
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof ArrApiError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new ArrConnectionError(
          `Request timed out after ${this.timeout}ms`,
          url,
        );
      }

      throw new ArrConnectionError(
        `Failed to connect to Arr instance: ${error instanceof Error ? error.message : String(error)}`,
        url,
        error instanceof Error ? error : undefined,
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
