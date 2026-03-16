import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ToastModule from '../../src/client/components/Toast';
import { notifyInstanceTestError, notifyInstanceTestResult } from '../../src/client/hooks/useInstances';

describe('instance test notifications', () => {
  beforeEach(() => {
    vi.spyOn(ToastModule, 'toast').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows and logs the specific connection failure message', () => {
    notifyInstanceTestResult({ success: false, error: 'Unauthorized: invalid API key' });

    expect(ToastModule.toast).toHaveBeenCalledWith('error', 'Unauthorized: invalid API key');
    expect(console.error).toHaveBeenCalledWith(
      'Arr instance connection test failed:',
      'Unauthorized: invalid API key',
    );
  });

  it('shows and logs thrown instance test errors', () => {
    const error = new Error('Request timed out after 30000ms');

    notifyInstanceTestError(error);

    expect(ToastModule.toast).toHaveBeenCalledWith('error', 'Request timed out after 30000ms');
    expect(console.error).toHaveBeenCalledWith('Arr instance connection test failed:', error);
  });
});