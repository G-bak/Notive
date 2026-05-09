import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@notive/auth": new URL("./packages/auth/src/index.ts", import.meta.url).pathname,
      "@notive/db": new URL("./packages/db/src/index.ts", import.meta.url).pathname,
      "@notive/mail": new URL("./packages/mail/src/index.ts", import.meta.url).pathname,
      "@notive/permissions": new URL("./packages/permissions/src/index.ts", import.meta.url)
        .pathname,
      "@notive/redis": new URL("./packages/redis/src/index.ts", import.meta.url).pathname,
      "@notive/shared": new URL("./packages/shared/src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    // Integration tests live in tests/integration and have their own
    // vitest config (they need an embedded Postgres). Run them via
    // `pnpm test:integration`.
    include: ["tests/unit/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "tests/e2e/**",
      "tests/integration/**",
    ],
    environment: "node",
    reporters: ["default"],
  },
});
