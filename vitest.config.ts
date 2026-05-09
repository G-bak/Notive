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
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "tests/e2e/**"],
    environment: "node",
    reporters: ["default"],
  },
});
