import { describe, expect, it } from "vitest";

import {
  ApiError,
  Errors,
  assertNotLastAdmin,
  requireActiveUser,
  requireAdmin,
  requireMembership,
  roleAtLeast,
} from "@notive/permissions";

// ---------------------------------------------------------------------
// Envelope shape
// ---------------------------------------------------------------------

describe("ApiError + Errors envelope", () => {
  it("NOT_FOUND carries no reason_code", () => {
    const e = Errors.notFound();
    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe("NOT_FOUND");
    expect(e.status).toBe(404);
    expect(e.reason).toBeNull();
  });

  it("FORBIDDEN carries the reason verbatim", () => {
    const e = Errors.forbidden("admin_only");
    expect(e.code).toBe("FORBIDDEN");
    expect(e.status).toBe(403);
    expect(e.reason).toBe("admin_only");
  });

  it("CONFLICT carries the reason verbatim", () => {
    const e = Errors.conflict("already_in_organization");
    expect(e.code).toBe("CONFLICT");
    expect(e.status).toBe(409);
    expect(e.reason).toBe("already_in_organization");
  });

  it("INVALID_INPUT carries no reason but exposes the message", () => {
    const e = Errors.invalid("name too short");
    expect(e.code).toBe("INVALID_INPUT");
    expect(e.status).toBe(400);
    expect(e.reason).toBeNull();
    expect(e.message).toBe("name too short");
  });
});

// ---------------------------------------------------------------------
// roleAtLeast
// ---------------------------------------------------------------------

describe("roleAtLeast", () => {
  it("Admin satisfies every threshold", () => {
    expect(roleAtLeast("Admin", "Viewer")).toBe(true);
    expect(roleAtLeast("Admin", "Editor")).toBe(true);
    expect(roleAtLeast("Admin", "Manager")).toBe(true);
    expect(roleAtLeast("Admin", "Admin")).toBe(true);
  });

  it("Editor satisfies Viewer/Editor but not Manager/Admin", () => {
    expect(roleAtLeast("Editor", "Viewer")).toBe(true);
    expect(roleAtLeast("Editor", "Editor")).toBe(true);
    expect(roleAtLeast("Editor", "Manager")).toBe(false);
    expect(roleAtLeast("Editor", "Admin")).toBe(false);
  });
});

// ---------------------------------------------------------------------
// requireActiveUser
// ---------------------------------------------------------------------

describe("requireActiveUser", () => {
  it("passes when status is Active", () => {
    expect(() => requireActiveUser({ status: "Active" })).not.toThrow();
  });

  it("rejects Pending with FORBIDDEN(account_not_active)", () => {
    try {
      requireActiveUser({ status: "Pending" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("FORBIDDEN");
      expect((err as ApiError).reason).toBe("account_not_active");
    }
  });

  it("rejects Disabled with FORBIDDEN(account_not_active)", () => {
    expect(() => requireActiveUser({ status: "Disabled" })).toThrowError(ApiError);
  });
});

// ---------------------------------------------------------------------
// requireAdmin
// ---------------------------------------------------------------------

describe("requireAdmin", () => {
  it("passes for Admin", () => {
    expect(() => requireAdmin({ role: "Admin" })).not.toThrow();
  });

  it("rejects Editor with FORBIDDEN(admin_only)", () => {
    try {
      requireAdmin({ role: "Editor" });
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ApiError).code).toBe("FORBIDDEN");
      expect((err as ApiError).reason).toBe("admin_only");
    }
  });

  it("rejects Manager with FORBIDDEN(admin_only) by default", () => {
    try {
      requireAdmin({ role: "Manager" });
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ApiError).reason).toBe("admin_only");
    }
  });

  it("rejects Manager with FORBIDDEN(manager_cannot_invite) when reason override is supplied", () => {
    try {
      requireAdmin({ role: "Manager" }, "manager_cannot_invite");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ApiError).code).toBe("FORBIDDEN");
      expect((err as ApiError).reason).toBe("manager_cannot_invite");
    }
  });

  it("rejects Viewer", () => {
    expect(() => requireAdmin({ role: "Viewer" })).toThrowError(ApiError);
  });
});

// ---------------------------------------------------------------------
// requireMembership — uses a tiny fake PrismaClient. The helper only
// touches `prisma.membership.findFirst`, so a hand-rolled stub keeps
// the test fast and DB-less.
// ---------------------------------------------------------------------

interface FakeMembership {
  id: string;
  userId: string;
  organizationId: string;
  role: "Viewer" | "Editor" | "Manager" | "Admin";
  status: "Active" | "Disabled" | "Removed" | "Invited";
  deletedAt: Date | null;
}

function makePrismaForMembership(rows: FakeMembership[]) {
  return {
    membership: {
      async findFirst({
        where,
      }: {
        where: { userId: string; organizationId: string; status: string; deletedAt: null };
      }): Promise<FakeMembership | null> {
        return (
          rows.find(
            (r) =>
              r.userId === where.userId &&
              r.organizationId === where.organizationId &&
              r.status === where.status &&
              r.deletedAt === null,
          ) ?? null
        );
      },
      async count({
        where,
      }: {
        where: {
          organizationId: string;
          role: string;
          status: string;
          deletedAt: null;
          NOT: { id: string };
        };
      }): Promise<number> {
        return rows.filter(
          (r) =>
            r.organizationId === where.organizationId &&
            r.role === where.role &&
            r.status === where.status &&
            r.deletedAt === null &&
            r.id !== where.NOT.id,
        ).length;
      },
    },
  } as never;
}

describe("requireMembership hides cross-org access as NOT_FOUND", () => {
  const rows: FakeMembership[] = [
    {
      id: "m-self",
      userId: "u-1",
      organizationId: "o-1",
      role: "Editor",
      status: "Active",
      deletedAt: null,
    },
  ];

  it("returns the membership when active", async () => {
    const prisma = makePrismaForMembership(rows);
    const m = await requireMembership(prisma, "u-1", "o-1");
    expect(m.id).toBe("m-self");
  });

  it("non-member of an existing org -> NOT_FOUND (no reason_code)", async () => {
    const prisma = makePrismaForMembership(rows);
    try {
      await requireMembership(prisma, "u-2", "o-1");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ApiError).code).toBe("NOT_FOUND");
      expect((err as ApiError).reason).toBeNull();
    }
  });

  it("guessed/unknown org -> NOT_FOUND", async () => {
    const prisma = makePrismaForMembership(rows);
    await expect(requireMembership(prisma, "u-1", "o-bogus")).rejects.toMatchObject({
      code: "NOT_FOUND",
      reason: null,
    });
  });
});

// ---------------------------------------------------------------------
// assertNotLastAdmin
// ---------------------------------------------------------------------

describe("assertNotLastAdmin", () => {
  it("no-op when membership is not Admin", async () => {
    const prisma = makePrismaForMembership([]);
    await expect(
      assertNotLastAdmin(prisma, { id: "m", organizationId: "o", role: "Editor" }),
    ).resolves.toBeUndefined();
  });

  it("rejects with FORBIDDEN(last_admin_protection) when no other active Admin exists", async () => {
    const prisma = makePrismaForMembership([
      {
        id: "m-admin",
        userId: "u-admin",
        organizationId: "o",
        role: "Admin",
        status: "Active",
        deletedAt: null,
      },
    ]);
    try {
      await assertNotLastAdmin(prisma, { id: "m-admin", organizationId: "o", role: "Admin" });
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ApiError).code).toBe("FORBIDDEN");
      expect((err as ApiError).reason).toBe("last_admin_protection");
    }
  });

  it("passes when at least one other active Admin remains", async () => {
    const prisma = makePrismaForMembership([
      {
        id: "m-self",
        userId: "u1",
        organizationId: "o",
        role: "Admin",
        status: "Active",
        deletedAt: null,
      },
      {
        id: "m-other",
        userId: "u2",
        organizationId: "o",
        role: "Admin",
        status: "Active",
        deletedAt: null,
      },
    ]);
    await expect(
      assertNotLastAdmin(prisma, { id: "m-self", organizationId: "o", role: "Admin" }),
    ).resolves.toBeUndefined();
  });
});
