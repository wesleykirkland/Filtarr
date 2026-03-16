import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getConfig, loadConfig, resetConfigCache } from '../../src/config/index.js';

describe('config index', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env['FILTARR_PORT'];
    delete process.env['PORT'];
    delete process.env['FILTARR_HOST'];
    delete process.env['FILTARR_DATA_DIR'];
    delete process.env['FILTARR_LOG_LEVEL'];
    delete process.env['NODE_ENV'];
    resetConfigCache();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetConfigCache();
  });

  it('loads default config values', () => {
    expect(loadConfig()).toEqual({
      port: 9898,
      host: '0.0.0.0',
      dataDir: './data',
      logLevel: 'info',
      nodeEnv: 'production',
    });
  });

  it('uses environment overrides and caches the first result', () => {
    process.env['FILTARR_PORT'] = '7777';
    process.env['FILTARR_HOST'] = '127.0.0.1';
    process.env['FILTARR_DATA_DIR'] = '/tmp/filtarr';
    process.env['FILTARR_LOG_LEVEL'] = 'debug';
    process.env['NODE_ENV'] = 'test';

    const first = loadConfig();
    process.env['FILTARR_PORT'] = '8888';

    expect(first).toMatchObject({
      port: 7777,
      host: '127.0.0.1',
      dataDir: '/tmp/filtarr',
      logLevel: 'debug',
      nodeEnv: 'test',
    });
    expect(getConfig()).toBe(first);
    expect(getConfig().port).toBe(7777);
  });

  it('can be reset so changed environment values take effect', () => {
    process.env['PORT'] = '5050';
    expect(loadConfig().port).toBe(5050);

    process.env['PORT'] = '6060';
    resetConfigCache();

    expect(loadConfig().port).toBe(6060);
  });

  it('surfaces readable validation errors', () => {
    process.env['FILTARR_PORT'] = '70000';
    process.env['NODE_ENV'] = 'staging';

    expect(() => loadConfig()).toThrow(/Invalid configuration:/);
  });
});