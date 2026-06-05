import { defineConfig } from 'vitest/config';
import coverageThresholds from './src/test/coverage.config.js';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Only measure the application logic, not entry points / glue that is
      // exercised end-to-end rather than by unit tests.
      include: ['src/**/*.ts'],
      exclude: [
        'src/test/**',
        'src/types.ts',
        'src/web/views.ts',
        'src/web/server.ts',
        'src/index.ts',
        'src/scripts/**',
      ],
      thresholds: coverageThresholds,
    },
  },
});
