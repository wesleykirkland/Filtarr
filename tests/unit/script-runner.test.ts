import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock('../../src/server/lib/logger.js', () => ({ logger: { warn: state.warn } }));

import { runConfiguredScript, runSandboxedScript } from '../../src/server/services/scriptRunner.js';

describe('runSandboxedScript', () => {
  beforeEach(() => {
    state.warn.mockReset();
  });

  it('executes scripts with sandboxed context and captured console output', async () => {
    const result = await runSandboxedScript(
      "console.log('hello', context.name); console.warn('watch'); return context.value + 1;",
      { name: 'Filtarr', value: 2 },
    );

    expect(result).toEqual({
      success: true,
      output: 3,
      logs: ['hello Filtarr', 'WARN: watch'],
    });
  });

  it('returns execution failures and logs them through the server logger', async () => {
    const result = await runSandboxedScript(
      "console.error('boom'); throw new Error('kaboom');",
      {},
    );

    expect(result).toEqual({
      success: false,
      error: 'kaboom',
      logs: ['ERROR: boom'],
    });
    expect(state.warn).toHaveBeenCalledWith(
      { err: 'kaboom' },
      'Sandboxed script execution failed or threw',
    );
  });
});

describe('runConfiguredScript feature gate', () => {
  const original = process.env['FILTARR_ENABLE_CUSTOM_SCRIPTS'];

  afterEach(() => {
    if (original === undefined) delete process.env['FILTARR_ENABLE_CUSTOM_SCRIPTS'];
    else process.env['FILTARR_ENABLE_CUSTOM_SCRIPTS'] = original;
  });

  it.each(['javascript', 'shell'] as const)(
    'refuses to run %s scripts when custom scripts are disabled',
    async (runtime) => {
      delete process.env['FILTARR_ENABLE_CUSTOM_SCRIPTS'];
      const code = runtime === 'shell' ? 'echo ran' : "console.log('ran'); return 1;";

      const result = await runConfiguredScript(code, {}, runtime);

      expect(result.success).toBe(false);
      expect(result.output).toBeUndefined();
      expect(result.error).toContain('FILTARR_ENABLE_CUSTOM_SCRIPTS=true');
      expect(result.logs).not.toContain('ran');
    },
  );

  it('runs scripts when custom scripts are enabled', async () => {
    process.env['FILTARR_ENABLE_CUSTOM_SCRIPTS'] = 'true';

    const result = await runConfiguredScript('return 41 + 1;', {}, 'javascript');

    expect(result).toEqual({ success: true, output: 42, logs: [] });
  });
});
