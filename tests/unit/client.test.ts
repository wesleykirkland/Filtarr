import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ArrClient, MAX_RESPONSE_BYTES } from '../../src/services/arr/client.js';

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
    const client = new TestArrClient({ baseUrl: 'https://example.com', apiKey: 'test-key', timeout: 1000, maxRetries: 0 });
    mockFetch.mockReset();
    mockFetch
      .mockRejectedValueOnce(new DOMException('aborted', 'AbortError'))
      .mockRejectedValueOnce(new Error('offline'));

    await expect(client.testGet('/api/v3/system/status')).rejects.toMatchObject({
      name: 'ArrConnectionError',
      message: 'Request timed out after 1000ms',
    });
    await expect(client.testGet('/api/v3/system/status')).rejects.toMatchObject({
      name: 'ArrConnectionError',
      message: expect.stringContaining('offline'),
    });
  });

  it('maps testConnection success and failure responses to generic categories', async () => {
    const client = new TestArrClient({ baseUrl: 'https://example.com', apiKey: 'test-key', timeout: 1000 });
    mockFetch.mockReset();
    mockFetch
      .mockResolvedValueOnce(createResponse({ body: { appName: 'Sonarr', version: '4.0.0' } }))
      .mockResolvedValueOnce(createResponse({ ok: false, status: 401, statusText: 'Unauthorized', text: 'secret body' }))
      .mockRejectedValueOnce(new Error('ECONNREFUSED 10.0.0.5:22'))
      .mockRejectedValueOnce(new DOMException('aborted', 'AbortError'))
      .mockResolvedValueOnce(createResponse({ text: 'SSH-2.0-OpenSSH_9.6 banner' }))
      .mockResolvedValueOnce(createResponse({ ok: false, status: 503, statusText: 'Unavailable', text: 'busy' }));

    await expect(client.testConnection()).resolves.toEqual({
      success: true,
      appName: 'Sonarr',
      appVersion: '4.0.0',
    });
    await expect(client.testConnection()).resolves.toMatchObject({ success: false, errorCode: 'unauthorized' });
    await expect(client.testConnection()).resolves.toMatchObject({ success: false, errorCode: 'unreachable' });
    await expect(client.testConnection()).resolves.toMatchObject({ success: false, errorCode: 'timeout' });
    const invalid = await client.testConnection();
    expect(invalid).toMatchObject({ success: false, errorCode: 'unexpected_response' });
    expect(JSON.stringify(invalid)).not.toContain('SSH');
    // Retryable status still makes only one attempt for connection tests.
    await expect(client.testConnection()).resolves.toMatchObject({ success: false, errorCode: 'unexpected_response' });
    expect(mockFetch).toHaveBeenCalledTimes(6);
  });

  it('does not follow redirects and treats 3xx responses as errors', async () => {
    const client = new TestArrClient({ baseUrl: 'https://example.com', apiKey: 'test-key', maxRetries: 2 });
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 302,
      statusText: 'Found',
      headers: new Headers({ location: 'https://attacker.example/steal' }),
      body: null,
      text: async () => '',
    });

    const error = await client.testGet('/api/v3/system/status').catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'ArrApiError', statusCode: 302, kind: 'redirect' });
    expect((error as Error).message).not.toContain('attacker');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][1].redirect).toBe('manual');
  });

  it('rejects responses whose content-length exceeds the size cap', async () => {
    const client = new TestArrClient({ baseUrl: 'https://example.com', apiKey: 'test-key' });
    const text = vi.fn(async () => '{}');
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': String(MAX_RESPONSE_BYTES + 1) }),
      body: null,
      text,
    });

    await expect(client.testGet('/api/v3/queue')).rejects.toMatchObject({
      name: 'ArrApiError',
      kind: 'response_too_large',
    });
    expect(text).not.toHaveBeenCalled();
  });

  it('stops reading a streamed body once it exceeds the size cap', async () => {
    const client = new TestArrClient({ baseUrl: 'https://example.com', apiKey: 'test-key' });
    const chunk = new Uint8Array(1024 * 1024).fill(0x20);
    let pulled = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(new Response(stream, { status: 200 }));

    await expect(client.testGet('/api/v3/queue')).rejects.toMatchObject({
      name: 'ArrApiError',
      kind: 'response_too_large',
    });
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThanOrEqual(Math.ceil(MAX_RESPONSE_BYTES / chunk.byteLength) + 2);
  });

  it('parses streamed JSON bodies and does not echo invalid JSON in errors', async () => {
    const client = new TestArrClient({ baseUrl: 'https://example.com', apiKey: 'test-key' });
    mockFetch.mockReset();
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response('<html>internal admin page</html>', { status: 200 }));

    await expect(client.testGet('/api/v3/system/status')).resolves.toEqual({ ok: true });
    const error = await client.testGet('/api/v3/system/status').catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'ArrApiError', kind: 'invalid_json' });
    expect((error as Error).message).not.toContain('internal admin');
  });

  it('reuses a single Agent per client and destroys it on close', async () => {
    const client = new TestArrClient({
      baseUrl: 'https://example.com',
      apiKey: 'test-key',
      skipSslVerify: true,
    });

    await client.testGet('/api/v3/system/status');
    await client.testGet('/api/v3/health');

    const first = mockFetch.mock.calls[0][1].dispatcher;
    expect(first.constructor.name).toBe('Agent');
    expect(mockFetch.mock.calls[1][1].dispatcher).toBe(first);

    const destroy = vi.spyOn(first, 'destroy');
    await client.close();
    expect(destroy).toHaveBeenCalled();
    expect(first.destroyed).toBe(true);

    await client.testGet('/api/v3/health');
    expect(mockFetch.mock.calls[2][1].dispatcher).not.toBe(first);
    await client.close();
  });

  it('close is a no-op without a custom dispatcher', async () => {
    const client = new TestArrClient({ baseUrl: 'https://example.com', apiKey: 'test-key' });
    await expect(client.close()).resolves.toBeUndefined();
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

describe('ArrClient timeout bounds', () => {
  const base = { baseUrl: 'http://localhost:8989', apiKey: 'k' };
  const timeoutOf = (client: ArrClient) => (client as unknown as { timeout: number }).timeout;

  it('defaults to 30 seconds when no timeout is given', () => {
    expect(timeoutOf(new ArrClient(base))).toBe(30_000);
  });

  it('clamps out-of-range and non-finite timeouts', () => {
    expect(timeoutOf(new ArrClient({ ...base, timeout: 1 }))).toBe(1_000);
    expect(timeoutOf(new ArrClient({ ...base, timeout: 10_000_000 }))).toBe(300_000);
    expect(timeoutOf(new ArrClient({ ...base, timeout: Number.NaN }))).toBe(30_000);
    expect(timeoutOf(new ArrClient({ ...base, timeout: 45_000 }))).toBe(45_000);
  });
});

describe('ArrClient.getAllQueueItems', () => {
  function pageResponse(page: number, pageSize: number, totalRecords: number) {
    const start = (page - 1) * pageSize;
    const count = Math.max(0, Math.min(pageSize, totalRecords - start));
    const records = Array.from({ length: count }, (_, i) => ({ id: start + i + 1 }));
    return createResponse({ body: { page, pageSize, totalRecords, records } });
  }

  function mockQueue(totalRecords: number) {
    mockFetch.mockReset();
    mockFetch.mockImplementation(async (url: string) => {
      const params = new URL(url).searchParams;
      return pageResponse(Number(params.get('page')), Number(params.get('pageSize')), totalRecords);
    });
  }

  it('fetches every page until totalRecords is reached', async () => {
    mockQueue(250);
    const client = new TestArrClient({ baseUrl: 'https://example.com', apiKey: 'k' });

    const items = await client.getAllQueueItems();

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(items).toHaveLength(250);
    expect(new Set(items.map((i) => i.id)).size).toBe(250);
    const pages = mockFetch.mock.calls.map(([url]) => new URL(url as string).searchParams.get('page'));
    expect(pages).toEqual(['1', '2', '3']);
  });

  it('stops after maxPages', async () => {
    mockQueue(1000);
    const client = new TestArrClient({ baseUrl: 'https://example.com', apiKey: 'k' });

    const items = await client.getAllQueueItems(2);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(items).toHaveLength(200);
  });

  it('makes a single request when the queue fits on one page', async () => {
    mockQueue(0);
    const client = new TestArrClient({ baseUrl: 'https://example.com', apiKey: 'k' });

    expect(await client.getAllQueueItems()).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
