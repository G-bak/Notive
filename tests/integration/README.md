# Integration tests

Phase B step 3 (DB / Prisma) and later add real-Postgres integration tests
here. They run with Vitest and use a test container or a per-test schema.

Convention: `*.test.ts`, environment `node`, no Prisma mocking.
