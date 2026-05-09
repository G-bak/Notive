// Boot a self-contained Postgres for the integration test run.
//
// We use `embedded-postgres` so integration tests do not require Docker
// or a host-installed Postgres. Phase B doc §13.8 says integration
// tests must run against real Postgres (no Prisma mocking) — embedded
// Postgres is real Postgres, just managed by Node.

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import EmbeddedPostgres from "embedded-postgres";

const require = createRequire(import.meta.url);
const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const PGDATA = join(HERE, "..", ".pgdata");

let pg: EmbeddedPostgres | null = null;

function pickPort(): number {
  // 5500-5999 is unlikely to collide with a developer's local Postgres.
  return 5500 + Math.floor(Math.random() * 500);
}

export async function setup() {
  // Clean up any stale data dir from a crashed run.
  rmSync(PGDATA, { recursive: true, force: true });
  mkdirSync(PGDATA, { recursive: true });

  const port = pickPort();
  pg = new EmbeddedPostgres({
    databaseDir: PGDATA,
    user: "notive",
    password: "notive",
    port,
    persistent: false,
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase("notive_test");

  const url = `postgresql://notive:notive@localhost:${port}/notive_test`;
  process.env.DATABASE_URL = url;
  process.env.DIRECT_DATABASE_URL = url;
  process.env.NOTIVE_TEST_PG_PORT = String(port);

  // Run Prisma migrations against the embedded DB.
  // We invoke the Prisma CLI via Node (not pnpm) because the Vitest
  // global-setup runs inside an arbitrary cwd and pnpm scripts depend
  // on dotenv-cli loading the root .env, which is not what we want
  // here. We pass DATABASE_URL via the spawned env.
  const prismaCli = require.resolve("prisma/build/index.js");
  const schemaPath = join(REPO_ROOT, "packages", "db", "prisma", "schema.prisma");

  const result = spawnSync(
    process.execPath,
    [prismaCli, "migrate", "deploy", "--schema", schemaPath],
    {
      env: { ...process.env, DATABASE_URL: url, DIRECT_DATABASE_URL: url },
      stdio: "inherit",
    },
  );
  if (result.status !== 0) {
    throw new Error(`prisma migrate deploy failed with exit code ${result.status}`);
  }
}

export async function teardown() {
  if (pg) {
    try {
      await pg.stop();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[integration] failed to stop embedded postgres:", err);
    }
    pg = null;
  }
  rmSync(PGDATA, { recursive: true, force: true });
}
