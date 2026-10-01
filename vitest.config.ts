import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Most tests spawn the built CLI, several times over; under load one
    // spawn can outlast the 5s default.
    testTimeout: 120_000,
  },
});
