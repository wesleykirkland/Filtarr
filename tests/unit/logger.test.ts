import { describe, expect, it } from 'vitest';
import { resolveLogLevel } from '../../src/server/lib/logger.js';

describe('resolveLogLevel', () => {
  it('prefers FILTARR_LOG_LEVEL', () => {
    expect(resolveLogLevel({ FILTARR_LOG_LEVEL: 'debug', LOG_LEVEL: 'error' })).toBe('debug');
  });

  it('falls back to LOG_LEVEL for compatibility', () => {
    expect(resolveLogLevel({ LOG_LEVEL: 'warn' })).toBe('warn');
  });

  it('normalizes case and defaults to info', () => {
    expect(resolveLogLevel({ FILTARR_LOG_LEVEL: 'ERROR' })).toBe('error');
    expect(resolveLogLevel({})).toBe('info');
    expect(resolveLogLevel({ FILTARR_LOG_LEVEL: 'verbose' })).toBe('info');
  });
});
