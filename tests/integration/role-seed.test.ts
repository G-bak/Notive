import { describe, it, expect } from "vitest";

import { prisma } from "@notive/db";

describe("system role seed", () => {
  it("seeds Viewer / Editor / Manager / Admin as system roles with organizationId null", async () => {
    const roles = await prisma.role.findMany({
      where: { isSystem: true, organizationId: null },
      orderBy: { code: "asc" },
    });
    const codes = roles.map((r) => r.code);
    // PostgreSQL enums sort by definition order, not alphabetical.
    // RoleCode is defined Viewer / Editor / Manager / Admin in schema.prisma.
    expect(codes).toEqual(["Viewer", "Editor", "Manager", "Admin"]);
    for (const r of roles) {
      expect(r.isSystem).toBe(true);
      expect(r.organizationId).toBeNull();
    }
  });

  it("rejects a duplicate system role per code (partial unique index)", async () => {
    await expect(
      prisma.role.create({
        data: {
          code: "Admin",
          name: "Admin Dup",
          description: "should fail",
          isSystem: true,
          organizationId: null,
        },
      }),
    ).rejects.toThrowError();
  });
});
