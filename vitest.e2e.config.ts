import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/e2e/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**"],
    environment: "node",
    // E2E pty tests need generous timeouts
    testTimeout: 60_000,
    hookTimeout: 30_000,
    globals: false,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
