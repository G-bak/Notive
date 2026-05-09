// One-shot helper to generate the initial Prisma migration against an
// embedded Postgres instance. Used during Phase B step 3 setup so that
// the `init` migration SQL is authoritative (Prisma-generated) rather
// than hand-rolled.
//
// Usage: node scripts/bootstrap-migration.mjs <name>

import EmbeddedPostgres from "embedded-postgres";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const require = createRequire(import.meta.url);

const HERE = fileURLToPath(new URL(".", import.meta.url));
// tests/integration/scripts -> repo root is three levels up.
const REPO_ROOT = join(HERE, "..", "..", "..");
const PG_DIR = join(HERE, "..", ".bootstrap-pg");

const migrationName = process.argv[2] ?? "init";
const port = 5800 + Math.floor(Math.random() * 100);

rmSync(PG_DIR, { recursive: true, force: true });
mkdirSync(PG_DIR, { recursive: true });

const pg = new EmbeddedPostgres({
  databaseDir: PG_DIR,
  user: "notive",
  password: "notive",
  port,
  persistent: false,
});

await pg.initialise();
await pg.start();
await pg.createDatabase("notive_bootstrap");

const url = `postgresql://notive:notive@localhost:${port}/notive_bootstrap`;
const schema = join(REPO_ROOT, "packages", "db", "prisma", "schema.prisma");
// Resolve the prisma CLI through the pnpm-flattened tree.
const prismaCli = require.resolve("prisma/build/index.js");

const result = spawnSync(
  process.execPath,
  [prismaCli, "migrate", "dev", "--name", migrationName, "--schema", schema],
  {
    env: { ...process.env, DATABASE_URL: url, DIRECT_DATABASE_URL: url },
    stdio: "inherit",
  },
);

await pg.stop();
rmSync(PG_DIR, { recursive: true, force: true });

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
