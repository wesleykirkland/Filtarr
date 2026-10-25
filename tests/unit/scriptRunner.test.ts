import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runConfiguredScript } from '../../src/server/services/scriptRunner.js';

describe('script runner', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env['FILTARR_ENABLE_CUSTOM_SCRIPTS'] = 'true';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('runs sandboxed JavaScript by default', async () => {
    const result = await runConfiguredScript(
      'return context.file.name.endsWith(".mkv");',
      {
        file: {
          path: '/downloads/movie.mkv',
          name: 'movie.mkv',
          size: 42,
          extension: 'mkv',
        },
      },
    );

    expect(result.success).toBe(true);
    expect(result.output).toBe(true);
  });

  it('runs shell scripts with file context in environment variables', async () => {
    const result = await runConfiguredScript(
      'if [[ "$FILTARR_FILE_NAME" == *.mkv ]]; then echo true; fi',
      {
        file: {
          path: '/downloads/movie.mkv',
          name: 'movie.mkv',
          size: 42,
          extension: 'mkv',
        },
      },
      'shell',
    );

    expect(result.success).toBe(true);
    expect(result.output).toBe('true');
  });

  it('does not expose host secrets to shell scripts', async () => {
    process.env['FILTARR_SECRET'] = 'top-secret';
    process.env['FILTARR_SESSION_SECRET'] = 'session-secret';

    const result = await runConfiguredScript(
      'echo "[$FILTARR_SECRET][$FILTARR_SESSION_SECRET][$FILTARR_ENABLE_CUSTOM_SCRIPTS]"',
      {},
      'shell',
    );

    expect(result.success).toBe(true);
    expect(result.output).toBe('[][][]');
  });

  it('passes allowlisted variables such as PATH to shell scripts', async () => {
    const result = await runConfiguredScript('echo "$PATH"', {}, 'shell');

    expect(result.success).toBe(true);
    expect(result.output).toBe(process.env['PATH']);
  });

  it('refuses to run when custom scripts are disabled', async () => {
    delete process.env['FILTARR_ENABLE_CUSTOM_SCRIPTS'];

    const result = await runConfiguredScript('echo ran', {}, 'shell');

    expect(result.success).toBe(false);
    expect(result.output).toBeUndefined();
    expect(result.error).toContain('FILTARR_ENABLE_CUSTOM_SCRIPTS=true');
  });
});
