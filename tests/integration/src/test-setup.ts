// Per-test setup: truncate all tables before each test and ensure the
// system role seed exists.
//
// Runs once per test file via Vitest's `setupFiles`.

import { afterAll, beforeEach } from "vitest";

import { prisma } from "@notive/db";

const TRUNCATE_ORDER = [
  // Children first.
  "activity_logs",
  "organization_settings",
  "memberships",
  "invitations",
  "sessions",
  "teams",
  "organizations",
  "users",
  "roles",
];

export async function truncateAllTables(): Promise<void> {
  // RESTART IDENTITY is a no-op for UUID PKs but documents intent.
  // CASCADE is required because of FK chains.
  const tableList = TRUNCATE_ORDER.map((t) => `"${t}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE ${tableList} RESTART IDENTITY CASCADE`);
}

export async function seedSystemRoles(): Promise<void> {
  const codes = ["Viewer", "Editor", "Manager", "Admin"] as const;
  for (const code of codes) {
    const existing = await prisma.role.findFirst({
      where: { code, organizationId: null, isSystem: true },
    });
    if (existing) {
      continue;
    }
    await prisma.role.create({
      data: {
        code,
        name: code,
        description: `${code} system role`,
        isSystem: true,
        organizationId: null,
      },
    });
  }
}

beforeEach(async () => {
  await truncateAllTables();
  await seedSystemRoles();
});

afterAll(async () => {
  await prisma.$disconnect();
});
