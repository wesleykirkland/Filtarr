// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, ApiError } from '../../src/client/lib/api';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch as typeof fetch;

function createResponse(options: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  body?: unknown;
  rejectJson?: boolean;
}) {
  const { ok = true, status = 200, statusText = 'OK', body, rejectJson = false } = options;
  return {
    ok,
    status,
    statusText,
    json: rejectJson ? vi.fn().mockRejectedValue(new Error('bad json')) : vi.fn().mockResolvedValue(body),
  };
}

describe('API Client', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.spyOn(globalThis, 'dispatchEvent');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dispatches auth:401 on unauthorized responses', async () => {
    mockFetch.mockResolvedValueOnce(
      createResponse({ ok: false, status: 401, statusText: 'Unauthorized', body: { error: 'Unauthorized' } }),
    );

    await expect(api.get('/some-protected-route')).rejects.toBeInstanceOf(ApiError);

    expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
    const event = (window.dispatchEvent as any).mock.calls[0][0];
    expect(event.type).toBe('auth:401');
  });

  it('does not dispatch auth:401 on other errors or successful responses', async () => {
    mockFetch
      .mockResolvedValueOnce(
        createResponse({ ok: false, status: 500, statusText: 'Server Error', body: { error: 'Server Error' } }),
      )
      .mockResolvedValueOnce(createResponse({ body: { data: 'Success' } }));

    await expect(api.get('/some-protected-route')).rejects.toBeInstanceOf(ApiError);
    await expect(api.get('/some-route')).resolves.toEqual({ data: 'Success' });

    expect(window.dispatchEvent).not.toHaveBeenCalled();
  });

  it('sends JSON requests for get/post/put/delete helpers and handles 204 responses', async () => {
    mockFetch
      .mockResolvedValueOnce(createResponse({ body: { id: 1 } }))
      // First state-changing request triggers a CSRF token fetch.
      .mockResolvedValueOnce(createResponse({ body: { csrfToken: 'csrf-token' } }))
      .mockResolvedValueOnce(createResponse({ body: { created: true } }))
      .mockResolvedValueOnce(createResponse({ body: { updated: true } }))
      .mockResolvedValueOnce(createResponse({ status: 204 }));

    await expect(api.get('/widgets')).resolves.toEqual({ id: 1 });
    await expect(api.post('/widgets', { name: 'alpha' })).resolves.toEqual({ created: true });
    await expect(api.put('/widgets/1', { enabled: true })).resolves.toEqual({ updated: true });
    await expect(api.delete('/widgets/1')).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenNthCalledWith(1, '/api/v1/widgets', expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(2, '/api/v1/auth/csrf', expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(3, '/api/v1/widgets', expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(4, '/api/v1/widgets/1', expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(5, '/api/v1/widgets/1', expect.any(Object));

    const firstHeaders = (mockFetch.mock.calls[0]?.[1] as RequestInit | undefined)?.headers as Headers | undefined;
    expect(firstHeaders?.get('Content-Type')).toBe('application/json');

    const postOptions = mockFetch.mock.calls[2]?.[1] as RequestInit | undefined;
    expect(postOptions).toEqual(expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'alpha' }) }));
    const postHeaders = postOptions?.headers as Headers | undefined;
    expect(postHeaders?.get('X-CSRF-Token')).toBe('csrf-token');

    const putOptions = mockFetch.mock.calls[3]?.[1] as RequestInit | undefined;
    expect(putOptions).toEqual(expect.objectContaining({ method: 'PUT', body: JSON.stringify({ enabled: true }) }));
    const putHeaders = putOptions?.headers as Headers | undefined;
    expect(putHeaders?.get('X-CSRF-Token')).toBe('csrf-token');

    const deleteOptions = mockFetch.mock.calls[4]?.[1] as RequestInit | undefined;
    expect(deleteOptions).toEqual(expect.objectContaining({ method: 'DELETE' }));
    const deleteHeaders = deleteOptions?.headers as Headers | undefined;
    expect(deleteHeaders?.get('X-CSRF-Token')).toBe('csrf-token');
  });

  it('extracts error details from nested messages, plain strings, and status text fallbacks', async () => {
    mockFetch
      .mockResolvedValueOnce(
        createResponse({ ok: false, status: 400, statusText: 'Bad Request', body: { error: { message: 'Invalid field' } } }),
      )
      .mockResolvedValueOnce(
        createResponse({ ok: false, status: 409, statusText: 'Conflict', body: { error: 'Already exists' } }),
      )
      .mockResolvedValueOnce(
        createResponse({ ok: false, status: 502, statusText: 'Bad Gateway', rejectJson: true }),
      );

    await expect(api.get('/nested')).rejects.toMatchObject({ status: 400, message: 'Invalid field' });
    await expect(api.get('/string')).rejects.toMatchObject({ status: 409, message: 'Already exists' });
    await expect(api.get('/fallback')).rejects.toMatchObject({ status: 502, message: 'Bad Gateway' });
  });
});
