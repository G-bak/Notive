import { describe, it, expect } from "vitest";

import { isLastAdminProtectionError, prisma } from "@notive/db";

import { createMembership, createOrganization, createUser } from "./src/helpers.js";

async function bootstrapOrgWithSoleAdmin() {
  const admin = await createUser("admin");
  const org = await createOrganization(admin.id, "lap");
  const membershipId = await createMembership({
    userId: admin.id,
    organizationId: org,
    role: "Admin",
    status: "Active",
  });
  return { adminUserId: admin.id, organizationId: org, membershipId };
}

describe("last-Admin protection trigger", () => {
  it("blocks demoting the last active Admin", async () => {
    const ctx = await bootstrapOrgWithSoleAdmin();
    const err = await prisma.membership
      .update({
        where: { id: ctx.membershipId },
        data: { role: "Editor" },
      })
      .catch((e) => e);
    expect(err).toBeDefined();
    expect(isLastAdminProtectionError(err)).toBe(true);
  });

  it("blocks disabling the last active Admin", async () => {
    const ctx = await bootstrapOrgWithSoleAdmin();
    const err = await prisma.membership
      .update({
        where: { id: ctx.membershipId },
        data: { status: "Disabled" },
      })
      .catch((e) => e);
    expect(err).toBeDefined();
    expect(isLastAdminProtectionError(err)).toBe(true);
  });

  it("blocks soft-deleting the last active Admin", async () => {
    const ctx = await bootstrapOrgWithSoleAdmin();
    const err = await prisma.membership
      .update({
        where: { id: ctx.membershipId },
        data: { deletedAt: new Date() },
      })
      .catch((e) => e);
    expect(err).toBeDefined();
    expect(isLastAdminProtectionError(err)).toBe(true);
  });

  it("blocks deleting the last active Admin row", async () => {
    const ctx = await bootstrapOrgWithSoleAdmin();
    const err = await prisma.membership.delete({ where: { id: ctx.membershipId } }).catch((e) => e);
    expect(err).toBeDefined();
    expect(isLastAdminProtectionError(err)).toBe(true);
  });

  it("allows demoting one of two active Admins", async () => {
    const ctx = await bootstrapOrgWithSoleAdmin();
    // Add a second active Admin (different user, same org).
    const second = await createUser("admin2");
    const secondId = await createMembership({
      userId: second.id,
      organizationId: ctx.organizationId,
      role: "Admin",
      status: "Active",
    });

    // Demoting the second Admin should succeed (the first one remains).
    const updated = await prisma.membership.update({
      where: { id: secondId },
      data: { role: "Editor" },
    });
    expect(updated.role).toBe("Editor");
  });
});
