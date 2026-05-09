/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended", "prettier"],
  ignorePatterns: [
    "node_modules",
    "dist",
    ".next",
    "next-env.d.ts",
    "playwright-report",
    "test-results",
    "coverage",
  ],
  env: {
    node: true,
    es2022: true,
  },
  overrides: [
    {
      files: ["apps/web/**/*.{ts,tsx}"],
      extends: ["next/core-web-vitals"],
      env: {
        browser: true,
      },
      settings: {
        next: {
          rootDir: "apps/web",
        },
      },
    },
    {
      files: ["**/*.test.ts", "**/*.spec.ts"],
      env: {
        node: true,
      },
    },
  ],
  rules: {
    "@typescript-eslint/no-unused-vars": [
      "warn",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
  },
};
