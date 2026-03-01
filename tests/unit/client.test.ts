import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ArrClient } from '../../src/services/arr/client.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

class TestArrClient extends ArrClient {
  public async testGet(endpoint: string) {
    return this.get(endpoint);
  }
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
});
