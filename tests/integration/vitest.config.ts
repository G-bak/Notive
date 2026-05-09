import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@notive/auth": new URL("../../packages/auth/src/index.ts", import.meta.url).pathname,
      "@notive/db": new URL("../../packages/db/src/index.ts", import.meta.url).pathname,
      "@notive/mail": new URL("../../packages/mail/src/index.ts", import.meta.url).pathname,
      "@notive/permissions": new URL("../../packages/permissions/src/index.ts", import.meta.url)
        .pathname,
      "@notive/shared": new URL("../../packages/shared/src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    include: ["**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.pgdata/**"],
    environment: "node",
    // Embedded Postgres bootstrap is slow on first run (binary download).
    // Each suite spins up its own DB sequentially to avoid port collisions.
    globalSetup: ["./src/global-setup.ts"],
    setupFiles: ["./src/test-setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    reporters: ["default"],
  },
});
