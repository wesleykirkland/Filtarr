// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from '../../src/client/lib/api';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('API Client', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.spyOn(window, 'dispatchEvent');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should dispatch auth:401 event on 401 response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    });

    try {
      await api.get('/some-protected-route');
    } catch (e) {
      // Expected to throw
    }

    expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
    const event = (window.dispatchEvent as any).mock.calls[0][0];
    expect(event.type).toBe('auth:401');
  });

  it('should not dispatch auth:401 event on other errors like 500', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Server Error' }),
    });

    try {
      await api.get('/some-protected-route');
    } catch (e) {
      // Expected to throw
    }

    expect(window.dispatchEvent).not.toHaveBeenCalled();
  });

  it('should not dispatch auth:401 event on successful response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: 'Success' }),
    });

    await api.get('/some-route');

    expect(window.dispatchEvent).not.toHaveBeenCalled();
  });
});
