/**
 * Base Arr API client with configurable timeout, automatic retry with
 * exponential backoff, and typed responses.
 *
 * All Arr apps (Sonarr, Radarr, Lidarr) share the same v3 API
 * structure. This base client handles authentication, retries, and error
 * mapping. App-specific clients extend this class.
 */

import { Agent } from 'undici';
import { validateArrInstanceUrl, stripTrailingSlashes } from '../security.js';
import { logger } from '../../server/lib/logger.js';

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
  type ConnectionTestErrorCode,
} from './types.js';

const DEFAULT_TIMEOUT = 30_000; // 30 seconds
const MIN_TIMEOUT = 1_000; // 1 second
const MAX_TIMEOUT = 300_000; // 5 minutes
const DEFAULT_MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 1000; // 1 second
const QUEUE_PAGE_SIZE = 100;
const DEFAULT_QUEUE_MAX_PAGES = 20;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
/** Upper bound on any Arr API response body we are willing to buffer. */
export const MAX_RESPONSE_BYTES = 25 * 1024 * 1024; // 25 MB
/** Error bodies are only kept for server-side diagnostics; keep them short. */
const MAX_ERROR_BODY_CHARS = 2048;

const CONNECTION_TEST_MESSAGES: Record<ConnectionTestErrorCode, string> = {
  unreachable: 'Could not connect to the instance',
  unauthorized: 'The instance rejected the API key',
  unexpected_response: 'The instance returned an unexpected response',
  timeout: 'The connection test timed out',
};

class ResponseTooLargeError extends Error {
  constructor() {
    super(`Response exceeded maximum size of ${MAX_RESPONSE_BYTES} bytes`);
    this.name = 'ResponseTooLargeError';
  }
}

interface ReadableResponseLike {
  headers?: { get(name: string): string | null } | null;
  body?: ReadableStream<Uint8Array> | null;
  text?: () => Promise<string>;
}

/** Sequentially drain a stream reader (each chunk depends on the previous read), enforcing `limit`. */
async function readStreamCapped(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  limit: number,
): Promise<string> {
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > limit) {
      await reader.cancel().catch(() => undefined);
      throw new ResponseTooLargeError();
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * Read a response body as text, refusing to buffer more than `limit` bytes.
 * Uses Content-Length when present and otherwise streams the body, cancelling
 * the stream as soon as the limit is exceeded.
 */
async function readBodyCapped(
  response: ReadableResponseLike,
  limit = MAX_RESPONSE_BYTES,
): Promise<string> {
  const declared = response.headers?.get('content-length');
  if (declared) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > limit) throw new ResponseTooLargeError();
  }

  const body = response.body;
  if (body && typeof body.getReader === 'function') {
    return readStreamCapped(body.getReader(), limit);
  }

  // Fallback for minimal Response-like objects without a stream body.
  const text = typeof response.text === 'function' ? await response.text() : '';
  if (Buffer.byteLength(text, 'utf8') > limit) throw new ResponseTooLargeError();
  return text;
}

function classifyConnectionTestError(error: unknown): ConnectionTestErrorCode {
  if (error instanceof ArrConnectionError) return error.isTimeout ? 'timeout' : 'unreachable';
  if (error instanceof ArrApiError && (error.statusCode === 401 || error.statusCode === 403)) {
    return 'unauthorized';
  }
  return 'unexpected_response';
}

/** Validate an Arr response (no redirects, 2xx) and decode its capped JSON body. */
async function parseArrResponse<T>(response: Response, url: string): Promise<T> {
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
    await response.body?.cancel().catch(() => undefined);
    throw new ArrApiError(
      `Arr API responded with a redirect (${response.status}); redirects are not followed`,
      response.status,
      url,
      undefined,
      'redirect',
    );
  }

  if (!response.ok) {
    const responseBody = await readBodyCapped(response).catch(() => '');
    throw new ArrApiError(
      `Arr API error: ${response.status} ${response.statusText}`,
      response.status,
      url,
      responseBody.slice(0, MAX_ERROR_BODY_CHARS),
    );
  }

  // Handle 204 No Content (e.g., DELETE responses)
  if (response.status === 204) {
    return undefined as T;
  }

  let text: string;
  try {
    text = await readBodyCapped(response);
  } catch (error) {
    if (error instanceof ResponseTooLargeError) {
      throw new ArrApiError(error.message, response.status, url, undefined, 'response_too_large');
    }
    throw error;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ArrApiError(
      'Arr API returned an invalid JSON response',
      response.status,
      url,
      undefined,
      'invalid_json',
    );
  }
}

type QueryParams = Record<string, string | number | boolean>;

/** Bound a caller-supplied timeout so request-controlled values cannot create unbounded timers. */
function clampTimeout(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TIMEOUT;
  return Math.min(Math.max(Math.trunc(value), MIN_TIMEOUT), MAX_TIMEOUT);
}

export class ArrClient {
  protected readonly baseUrl: string;
  protected readonly apiKey: string;
  protected readonly timeout: number;
  protected readonly maxRetries: number;
  protected readonly skipSslVerify: boolean;
  /** System status endpoint; Lidarr overrides this with its v1 path. */
  protected readonly systemStatusPath: string = '/api/v3/system/status';
  private dispatcher: Agent | undefined;

  constructor(options: ArrClientOptions) {
    const normalizedBaseUrl = validateArrInstanceUrl(options.baseUrl, options.skipSslVerify, {
      fieldName: 'Arr instance url',
    });

    // Normalize URL: remove trailing slash
    this.baseUrl = stripTrailingSlashes(normalizedBaseUrl);
    this.apiKey = options.apiKey;
    this.timeout = clampTimeout(options.timeout);
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.skipSslVerify = options.skipSslVerify ?? false;
  }

  // ── Core HTTP Methods ───────────────────────────────────────────────────

  protected async get<T>(path: string, params?: QueryParams): Promise<T> {
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

  protected async delete<T = void>(path: string, params?: QueryParams): Promise<T> {
    const url = this.buildUrl(path, params);
    return this.requestWithRetry<T>('DELETE', url);
  }

  // ── Shared Endpoints (all Arr apps) ─────────────────────────────────────

  /**
   * Test connection by fetching system status. Makes a single attempt (no
   * retries) and reports failures only as a generic category so callers
   * cannot use it to probe arbitrary hosts; details are logged server-side.
   */
  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const status = await this.requestWithRetry<SystemStatusResource>(
        'GET',
        this.buildUrl(this.systemStatusPath),
        undefined,
        0,
      );
      return {
        success: true,
        appName: status.appName,
        appVersion: status.version,
      };
    } catch (error) {
      const errorCode = classifyConnectionTestError(error);
      logger.warn(
        {
          errorCode,
          baseUrl: this.baseUrl,
          err:
            error instanceof Error ? { name: error.name, message: error.message } : String(error),
          statusCode: error instanceof ArrApiError ? error.statusCode : undefined,
        },
        'Arr connection test failed',
      );
      return { success: false, error: CONNECTION_TEST_MESSAGES[errorCode], errorCode };
    }
  }

  /** Release the client's dedicated connection pool (only used with skipSslVerify). */
  async close(): Promise<void> {
    const dispatcher = this.dispatcher;
    this.dispatcher = undefined;
    if (dispatcher) await dispatcher.destroy().catch(() => undefined);
  }

  /** GET /api/v3/system/status */
  async getSystemStatus(): Promise<SystemStatusResource> {
    return this.get<SystemStatusResource>(this.systemStatusPath);
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

  /**
   * Fetch all queue items, paginating automatically. Stops after `maxPages`
   * pages (default 20, i.e. 2000 items) to bound the work on huge queues.
   */
  async getAllQueueItems(maxPages = DEFAULT_QUEUE_MAX_PAGES): Promise<QueueResource[]> {
    const pageSize = QUEUE_PAGE_SIZE;
    const first = await this.getQueue(1, pageSize);
    const all = [...first.records];

    const totalPages = Math.ceil(first.totalRecords / pageSize);
    const lastPage = Math.min(totalPages, maxPages);
    for (let page = 2; page <= lastPage; page++) {
      const next = await this.getQueue(page, pageSize);
      all.push(...next.records);
    }

    // Results are capped at maxPages * pageSize; callers that need to know
    // whether the queue was truncated can compare all.length to first.totalRecords.
    return all;
  }

  /** DELETE /api/v3/queue/{id} with options */
  async deleteQueueItem(id: number, options: DeleteQueueOptions = {}): Promise<void> {
    const params: QueryParams = {};
    if (options.removeFromClient !== undefined)
      params['removeFromClient'] = options.removeFromClient;
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

  private buildUrl(path: string, params?: QueryParams): string {
    const url = new URL(path, this.baseUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private getDispatcher(): Agent | undefined {
    if (!this.skipSslVerify) return undefined;
    // One Agent per client, created lazily and reused across requests.
    this.dispatcher ??= new Agent({ connect: { rejectUnauthorized: false } });
    return this.dispatcher;
  }

  private async requestWithRetry<T>(
    method: string,
    url: string,
    body?: unknown,
    maxRetries: number = this.maxRetries,
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.request<T>(method, url, body);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on client errors (4xx) except specific retryable ones
        if (error instanceof ArrApiError && !RETRYABLE_STATUS_CODES.has(error.statusCode)) {
          throw error;
        }

        // Don't retry on last attempt
        if (attempt === maxRetries) {
          break;
        }

        // Exponential backoff with jitter
        const delay = RETRY_BASE_DELAY * Math.pow(2, attempt) + Math.random() * 500;
        await this.sleep(delay);
      }
    }

    if (lastError) throw lastError;
    throw new Error('Unknown error during retries');
  }

  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    // Bound again at the call site with an explicit comparison so static analysis
    // can see the timer duration is capped.
    const configuredTimeout = this.timeout;
    const timeoutMs = Math.min(configuredTimeout, MAX_TIMEOUT);
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = {
        'X-Api-Key': this.apiKey,
        Accept: 'application/json',
      };

      const init: RequestInit = {
        method,
        headers,
        signal: controller.signal,
        // Never follow redirects: that would forward X-Api-Key to another origin.
        redirect: 'manual',
      };

      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }

      // Node's native fetch uses undici; pass a per-client dispatcher instead
      // of changing the global one.
      const dispatcher = this.getDispatcher();

      const response = await fetch(url, { ...init, dispatcher } as RequestInit & {
        dispatcher?: unknown;
      });

      return await parseArrResponse<T>(response, url);
    } catch (error) {
      throw this.toRequestError(error, url);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private toRequestError(error: unknown, url: string): Error {
    if (error instanceof ArrApiError) return error;

    if (error instanceof DOMException && error.name === 'AbortError') {
      return new ArrConnectionError(
        `Request timed out after ${this.timeout}ms`,
        url,
        undefined,
        true,
      );
    }

    return new ArrConnectionError(
      `Failed to connect to Arr instance: ${error instanceof Error ? error.message : String(error)}`,
      url,
      error instanceof Error ? error : undefined,
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
