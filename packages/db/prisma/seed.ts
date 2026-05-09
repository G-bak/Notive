// System role seed.
//
// Phase A §15 / Phase B §9 lock four system roles. They live in the
// roles table with organizationId=null and isSystem=true. Custom
// per-organization roles can be added later without conflicting because
// the roles UNIQUE on (code, organizationId) treats NULL as distinct in
// PostgreSQL — but only one row per code can have organizationId=null,
// which is exactly what we want.
//
// This script is idempotent — re-running upserts each system role.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SYSTEM_ROLES = [
  { code: "Viewer", name: "Viewer", description: "Read-only access" },
  { code: "Editor", name: "Editor", description: "Author and edit documents" },
  {
    code: "Manager",
    name: "Manager",
    description: "Team-scope moderation",
  },
  { code: "Admin", name: "Admin", description: "Organization administrator" },
] as const;

async function main() {
  for (const role of SYSTEM_ROLES) {
    // Prisma's compound where rejects null for nullable unique columns,
    // so we look up via findFirst and decide between update/create
    // ourselves. The partial unique index `uniq_system_role_code`
    // guarantees concurrent inserts cannot create two rows for the same
    // code at the DB level (see migration 20260509101840).
    const existing = await prisma.role.findFirst({
      where: { code: role.code, organizationId: null, isSystem: true },
    });
    if (existing) {
      await prisma.role.update({
        where: { id: existing.id },
        data: {
          name: role.name,
          description: role.description,
          isSystem: true,
        },
      });
    } else {
      await prisma.role.create({
        data: {
          code: role.code,
          name: role.name,
          description: role.description,
          isSystem: true,
          organizationId: null,
        },
      });
    }
  }
  // eslint-disable-next-line no-console
  console.log("[seed] system roles ready:", SYSTEM_ROLES.map((r) => r.code).join(", "));
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
