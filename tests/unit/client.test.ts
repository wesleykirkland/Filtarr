import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ArrClient } from '../../src/services/arr/client.js';

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch as typeof fetch;

class TestArrClient extends ArrClient {
  public async testGet(endpoint: string) {
    return this.get(endpoint);
  }

  public async testPost(endpoint: string, body?: unknown) {
    return this.post(endpoint, body);
  }

  public async testPut(endpoint: string, body?: unknown) {
    return this.put(endpoint, body);
  }

  public async testDelete(endpoint: string, params?: Record<string, string | number | boolean>) {
    return this.delete(endpoint, params);
  }
}

function createResponse(options: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  body?: unknown;
  text?: string;
}) {
  const { ok = true, status = 200, statusText = 'OK', body = { success: true }, text } = options;
  return {
    ok,
    status,
    statusText,
    json: async () => body,
    text: async () => text ?? JSON.stringify(body),
  };
}

describe('ArrClient', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
      text: async () => '{"success":true}',
    });
  });

  it('should use default dispatcher when skipSslVerify is false or undefined', async () => {
    const client = new TestArrClient({
      baseUrl: 'https://example.com',
      apiKey: 'test-key',
    });

    await client.testGet('/api/v3/system/status');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callArgs = mockFetch.mock.calls[0];
    // Dispatcher should be undefined or not have rejectUnauthorized: false
    expect(callArgs[1].dispatcher).toBeUndefined();
  });

  it('should use a custom dispatcher with rejectUnauthorized: false when skipSslVerify is true', async () => {
    const client = new TestArrClient({
      baseUrl: 'https://example.com',
      apiKey: 'test-key',
      skipSslVerify: true,
    });

    await client.testGet('/api/v3/system/status');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callArgs = mockFetch.mock.calls[0];

    // Check if the custom dispatcher is passed to fetch
    expect(callArgs[1].dispatcher).toBeDefined();
    expect(callArgs[1].dispatcher.constructor.name).toBe('Agent');
  });

  it('allows localhost/private Arr instance URLs for internal Arr deployments', async () => {
    const client = new TestArrClient({
      baseUrl: 'http://127.0.0.1:8989',
      apiKey: 'test-key',
    });

    await client.testGet('/api/v3/system/status');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8989/api/v3/system/status',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('rejects skipSslVerify on non-https URLs', () => {
    expect(
      () =>
        new TestArrClient({
          baseUrl: 'http://example.com',
          apiKey: 'test-key',
          skipSslVerify: true,
        }),
    ).toThrow('https URLs');
  });

  it('serializes request bodies, query params, and 204 delete responses', async () => {
    mockFetch
      .mockResolvedValueOnce(createResponse({ body: { created: true } }))
      .mockResolvedValueOnce(createResponse({ body: { updated: true } }))
      .mockResolvedValueOnce(createResponse({ status: 204, body: undefined, text: '' }));

    const client = new TestArrClient({ baseUrl: 'https://example.com/', apiKey: 'test-key' });

    await expect(client.testPost('/api/v3/command', { name: 'RefreshSeries' })).resolves.toEqual({ created: true });
    await expect(client.testPut('/api/v3/settings', { enabled: true })).resolves.toEqual({ updated: true });
    await expect(client.testDelete('/api/v3/queue/8', { blocklist: true, removeFromClient: true })).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      'https://example.com/api/v3/command',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'RefreshSeries' }),
        headers: expect.objectContaining({ 'Content-Type': 'application/json', 'X-Api-Key': 'test-key' }),
      }),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'https://example.com/api/v3/settings',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ enabled: true }) }),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      3,
      'https://example.com/api/v3/queue/8?blocklist=true&removeFromClient=true',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('does not retry non-retryable api errors', async () => {
    const client = new TestArrClient({ baseUrl: 'https://example.com', apiKey: 'test-key', maxRetries: 2 });
    mockFetch.mockResolvedValueOnce(
      createResponse({ ok: false, status: 404, statusText: 'Not Found', text: 'missing' }),
    );

    await expect(client.testGet('/api/v3/missing')).rejects.toMatchObject({
      name: 'ArrApiError',
      statusCode: 404,
      responseBody: 'missing',
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries retryable failures and eventually succeeds', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const client = new TestArrClient({ baseUrl: 'https://example.com', apiKey: 'test-key', maxRetries: 1 });
    mockFetch
      .mockResolvedValueOnce(createResponse({ ok: false, status: 503, statusText: 'Unavailable', text: 'busy' }))
      .mockResolvedValueOnce(createResponse({ body: { ok: true } }));

    const request = client.testGet('/api/v3/system/status');
    await vi.runAllTimersAsync();

    await expect(request).resolves.toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('wraps aborts and network failures as connection errors', async () => {
    const client = new TestArrClient({ baseUrl: 'https://example.com', apiKey: 'test-key', timeout: 50, maxRetries: 0 });
    mockFetch.mockReset();
    mockFetch
      .mockRejectedValueOnce(new DOMException('aborted', 'AbortError'))
      .mockRejectedValueOnce(new Error('offline'));

    await expect(client.testGet('/api/v3/system/status')).rejects.toMatchObject({
      name: 'ArrConnectionError',
      message: 'Request timed out after 50ms',
    });
    await expect(client.testGet('/api/v3/system/status')).rejects.toMatchObject({
      name: 'ArrConnectionError',
      message: expect.stringContaining('offline'),
    });
  });

  it('maps testConnection success and failure responses', async () => {
    const client = new TestArrClient({ baseUrl: 'https://example.com', apiKey: 'test-key' });
    vi.spyOn(client, 'getSystemStatus')
      .mockResolvedValueOnce({ appName: 'Sonarr', version: '4.0.0' } as any)
      .mockRejectedValueOnce(new Error('denied'));

    await expect(client.testConnection()).resolves.toEqual({
      success: true,
      appName: 'Sonarr',
      appVersion: '4.0.0',
    });
    await expect(client.testConnection()).resolves.toEqual({ success: false, error: 'denied' });
  });

  it('routes shared endpoint helpers through the expected internal calls', async () => {
    const client = new TestArrClient({ baseUrl: 'https://example.com', apiKey: 'test-key' }) as any;
    const get = vi.spyOn(client, 'get').mockResolvedValue({});
    const post = vi.spyOn(client, 'post').mockResolvedValue({});
    const del = vi.spyOn(client, 'delete').mockResolvedValue(undefined);

    await client.getSystemStatus();
    await client.getHealth();
    await client.getQueue(2, 10);
    await client.deleteQueueItem(7, {
      removeFromClient: true,
      blocklist: true,
      skipRedownload: false,
      changeCategory: true,
    });
    await client.blocklistAndRemove(8);
    await client.getBlocklist(3, 5);
    await client.executeCommand({ name: 'RefreshSeries' });

    expect(get).toHaveBeenCalledWith('/api/v3/system/status');
    expect(get).toHaveBeenCalledWith('/api/v3/health');
    expect(get).toHaveBeenCalledWith('/api/v3/queue', {
      page: 2,
      pageSize: 10,
      sortKey: 'timeleft',
      sortDirection: 'ascending',
    });
    expect(del).toHaveBeenCalledWith('/api/v3/queue/7', {
      removeFromClient: true,
      blocklist: true,
      skipRedownload: false,
      changeCategory: true,
    });
    expect(del).toHaveBeenCalledWith('/api/v3/queue/8', {
      removeFromClient: true,
      blocklist: true,
    });
    expect(get).toHaveBeenCalledWith('/api/v3/blocklist', {
      page: 3,
      pageSize: 5,
      sortKey: 'date',
      sortDirection: 'descending',
    });
    expect(post).toHaveBeenCalledWith('/api/v3/command', { name: 'RefreshSeries' });
  });
});
