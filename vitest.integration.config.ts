import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**"],
    environment: "node",
    // Integration tests are slower — give them more time
    testTimeout: 120_000,
    hookTimeout: 30_000,
    globals: false,
    // Run integration tests sequentially to avoid FFmpeg resource contention
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
