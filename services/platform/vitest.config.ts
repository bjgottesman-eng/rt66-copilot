import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests share one real PostgreSQL cluster; run files serially
    // so CREATE/DROP DATABASE and role bootstrap never race each other.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
