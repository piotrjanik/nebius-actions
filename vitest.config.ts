import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Core library is plain Node code (mocks @actions/*); no DOM needed.
    environment: 'node',
    globals: true,
    include: ['__tests__/**/*.{test,spec}.ts'],
    // Fake timers are used for poller backoff/timeout tests (spec §8); leave the
    // toggle to individual tests via vi.useFakeTimers().
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts'],
      reporter: ['text', 'lcov'],
    },
  },
});
