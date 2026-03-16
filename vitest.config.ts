import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    coverage: {
      all: true,
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        // Approved exclusions: type-only modules and bootstrap entrypoints.
        'src/shared/types.ts',
        'src/services/arr/types.ts',
        'src/server/index.ts',
        'src/client/main.tsx',
      ],
      thresholds: {
        statements: 90,
        functions: 90,
        lines: 90,
        branches: 90,
      },
    },
  },
});
