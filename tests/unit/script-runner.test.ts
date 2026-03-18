import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  class MockSecurityPolicyError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'SecurityPolicyError';
    }
  }

  return {
    assertCustomScriptsEnabled: vi.fn(),
    warn: vi.fn(),
    SecurityPolicyError: MockSecurityPolicyError,
  };
});

vi.mock('../../src/services/security.js', () => ({
  assertCustomScriptsEnabled: state.assertCustomScriptsEnabled,
  SecurityPolicyError: state.SecurityPolicyError,
}));
vi.mock('../../src/server/lib/logger.js', () => ({ logger: { warn: state.warn } }));

import { runSandboxedScript } from '../../src/server/services/scriptRunner.js';

describe('runSandboxedScript', () => {
  beforeEach(() => {
    state.assertCustomScriptsEnabled.mockReset();
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