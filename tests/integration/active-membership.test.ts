import { describe, it, expect } from "vitest";

import { prisma } from "@notive/db";

import { createMembership, createOrganization, createUser } from "./src/helpers.js";

describe("active membership uniqueness (Phase A §15: 1 user = 1 organization)", () => {
  it("allows a user to have one Active membership", async () => {
    const user = await createUser("solo");
    const org = await createOrganization(user.id);
    const id = await createMembership({
      userId: user.id,
      organizationId: org,
      role: "Admin",
      status: "Active",
    });
    expect(id).toBeTruthy();
  });

  it("rejects a second Active membership in a different organization", async () => {
    const user = await createUser("dup");
    const orgA = await createOrganization(user.id, "orga");
    const orgB = await createOrganization(user.id, "orgb");

    await createMembership({
      userId: user.id,
      organizationId: orgA,
      role: "Admin",
      status: "Active",
    });

    await expect(
      createMembership({
        userId: user.id,
        organizationId: orgB,
        role: "Editor",
        status: "Active",
      }),
    ).rejects.toThrowError();
  });

  it("allows a second non-Active membership while one Active exists", async () => {
    const user = await createUser("mixed");
    const orgA = await createOrganization(user.id, "ma");
    const orgB = await createOrganization(user.id, "mb");

    await createMembership({
      userId: user.id,
      organizationId: orgA,
      role: "Admin",
      status: "Active",
    });

    // Removed status: not active, so the partial unique should not block this.
    const id = await createMembership({
      userId: user.id,
      organizationId: orgB,
      role: "Editor",
      status: "Removed",
    });
    expect(id).toBeTruthy();
  });

  it("blocks promoting a Removed membership back to Active when another Active exists", async () => {
    const user = await createUser("flip");
    const orgA = await createOrganization(user.id, "fa");
    const orgB = await createOrganization(user.id, "fb");

    await createMembership({
      userId: user.id,
      organizationId: orgA,
      role: "Admin",
      status: "Active",
    });

    const removed = await createMembership({
      userId: user.id,
      organizationId: orgB,
      role: "Editor",
      status: "Removed",
    });

    await expect(
      prisma.membership.update({
        where: { id: removed },
        data: { status: "Active" },
      }),
    ).rejects.toThrowError();
  });
});
