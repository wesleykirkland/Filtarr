import { describe, expect, it } from 'vitest';
import { runConfiguredScript } from '../../src/server/services/scriptRunner.js';

describe('script runner', () => {
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
});