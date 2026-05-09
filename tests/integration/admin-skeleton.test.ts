// Admin skeleton (Step 7) — server-side surface only.
//
// Tests drive the service functions directly; route handlers are thin
// pass-throughs that the build step has already type-checked. The
// admin entry policy is verified once here at the service boundary
// (admin home + admin members list); the mutation aliases (role/team/
// deactivate/reactivate, invitations create/cancel) delegate to the
// Step 5 services whose policies are covered by the Step 5 / Step 6
// integration tests — we re-assert the most important policy points
// here so that a regression in the wrapper would be visible.

import { describe, expect, it } from "vitest";

import { prisma } from "@notive/db";
import { InMemoryMailAdapter } from "@notive/mail";
import { ApiError } from "@notive/permissions";

import { getAdminHome, listAdminMembers } from "../../apps/web/lib/services/admin";
import { cancelInvitation, createInvitation } from "../../apps/web/lib/services/invitation";
import { changeRole, deactivateMembership } from "../../apps/web/lib/services/membership";
import { createOrganization } from "../../apps/web/lib/services/organization";

import { createUser } from "./src/helpers.js";

const APP_BASE_URL = "https://test.notive.local";
const INVITE_TTL_DAYS = 7;

interface ActiveUser {
  id: string;
  email: string;
  name: string;
  status: "Active";
}

async function createActiveUser(name: string): Promise<ActiveUser> {
  const u = await createUser(name);
  const full = await prisma.user.findUnique({ where: { id: u.id } });
  return {
    id: full!.id,
    email: full!.email,
    name: full!.name,
    status: "Active",
  };
}

async function expectApiError(
  promise: Promise<unknown>,
  code: ApiError["code"],
  reason?: string,
): Promise<void> {
  await expect(promise).rejects.toMatchObject(reason !== undefined ? { code, reason } : { code });
}

async function bootstrapOrgWithRoles() {
  const admin = await createActiveUser("ah-ad");
  const org = await createOrganization(prisma, admin, { name: "AdminOrg" });
  const adminMembership = (await prisma.membership.findFirst({
    where: { userId: admin.id, organizationId: org.id },
  }))!;

  const editor = await createActiveUser("ah-ed");
  await prisma.membership.create({
    data: { userId: editor.id, organizationId: org.id, role: "Editor", status: "Active" },
  });
  const manager = await createActiveUser("ah-mg");
  await prisma.membership.create({
    data: { userId: manager.id, organizationId: org.id, role: "Manager", status: "Active" },
  });
  const viewer = await createActiveUser("ah-vw");
  await prisma.membership.create({
    data: { userId: viewer.id, organizationId: org.id, role: "Viewer", status: "Active" },
  });
  return { admin, adminMembership, editor, manager, viewer, org };
}

describe("admin home placeholder", () => {
  it("Admin gets the placeholder shape", async () => {
    const { admin, adminMembership, org } = await bootstrapOrgWithRoles();
    const home = await getAdminHome(prisma, admin.id, org.id);
    expect(home.organization.id).toBe(org.id);
    expect(home.organization.name).toBe("AdminOrg");
    expect(home.organization.slug).toBeTruthy();
    expect(home.organization.status).toBe("Active");
    expect(home.membership.id).toBe(adminMembership.id);
    expect(home.membership.role).toBe("Admin");
    expect(home.sections.map((s) => s.key).sort()).toEqual(["invitations", "members"]);
    for (const s of home.sections) {
      expect(typeof s.label).toBe("string");
      expect(s.href.startsWith("/admin/")).toBe(true);
    }
  });

  it("Manager / Editor / Viewer all get FORBIDDEN(admin_only)", async () => {
    const { manager, editor, viewer, org } = await bootstrapOrgWithRoles();
    for (const u of [manager, editor, viewer]) {
      await expectApiError(getAdminHome(prisma, u.id, org.id), "FORBIDDEN", "admin_only");
    }
  });

  it("non-member of an existing org gets NOT_FOUND (no reason_code)", async () => {
    const { org } = await bootstrapOrgWithRoles();
    const stranger = await createActiveUser("ah-strange");
    await expectApiError(getAdminHome(prisma, stranger.id, org.id), "NOT_FOUND");
  });

  it("guessed/unknown org id gets NOT_FOUND", async () => {
    const u = await createActiveUser("ah-guess");
    await expectApiError(
      getAdminHome(prisma, u.id, "00000000-0000-0000-0000-000000000000"),
      "NOT_FOUND",
    );
  });
});

describe("admin members list", () => {
  it("Admin sees member rows joined with sanitized user fields", async () => {
    const { admin, org } = await bootstrapOrgWithRoles();
    const members = await listAdminMembers(prisma, admin.id, org.id);
    expect(members.length).toBe(4); // admin + editor + manager + viewer

    for (const row of members) {
      // Membership shape
      expect(row.membership.id).toEqual(expect.any(String));
      expect(["Active", "Disabled", "Removed", "Invited"]).toContain(row.membership.status);
      expect(["Viewer", "Editor", "Manager", "Admin"]).toContain(row.membership.role);
      // User shape
      expect(row.user.id).toEqual(expect.any(String));
      expect(row.user.name).toEqual(expect.any(String));
      expect(row.user.email).toEqual(expect.any(String));
      // Sensitive fields must not be present.
      expect((row.user as Record<string, unknown>).passwordHash).toBeUndefined();
      expect((row.user as Record<string, unknown>).emailVerificationTokenHash).toBeUndefined();
      expect((row.user as Record<string, unknown>).emailVerificationExpiresAt).toBeUndefined();
      expect((row.user as Record<string, unknown>).passwordResetTokenHash).toBeUndefined();
      expect((row.user as Record<string, unknown>).passwordResetExpiresAt).toBeUndefined();
    }
  });

  it("non-Admin members cannot list", async () => {
    const { manager, editor, viewer, org } = await bootstrapOrgWithRoles();
    for (const u of [manager, editor, viewer]) {
      await expectApiError(listAdminMembers(prisma, u.id, org.id), "FORBIDDEN", "admin_only");
    }
  });

  it("non-member listing is NOT_FOUND", async () => {
    const { org } = await bootstrapOrgWithRoles();
    const stranger = await createActiveUser("am-strange");
    await expectApiError(listAdminMembers(prisma, stranger.id, org.id), "NOT_FOUND");
  });
});

describe("admin mutation wrappers preserve Step 5 / Step 6 policies", () => {
  it("changeRole still enforces last-Admin protection", async () => {
    const { admin, adminMembership, org } = await bootstrapOrgWithRoles();
    // adminMembership is the only Admin in the org -> must be blocked.
    await expectApiError(
      changeRole(prisma, admin.id, org.id, adminMembership.id, { role: "Editor" }),
      "FORBIDDEN",
      "last_admin_protection",
    );
  });

  it("deactivateMembership still enforces last-Admin protection", async () => {
    const { admin, adminMembership, org } = await bootstrapOrgWithRoles();
    await expectApiError(
      deactivateMembership(prisma, admin.id, org.id, adminMembership.id),
      "FORBIDDEN",
      "last_admin_protection",
    );
  });

  it("Manager invoking createInvitation through the admin path is blocked with manager_cannot_invite", async () => {
    const { manager, org } = await bootstrapOrgWithRoles();
    const mail = new InMemoryMailAdapter();
    await expectApiError(
      createInvitation(
        prisma,
        mail,
        { id: manager.id, name: manager.name },
        org.id,
        { email: "x@example.test", role: "Editor" },
        { appBaseUrl: APP_BASE_URL, ttlDays: INVITE_TTL_DAYS },
      ),
      "FORBIDDEN",
      "manager_cannot_invite",
    );
  });

  it("Admin can create + cancel an invitation through the admin path", async () => {
    const { admin, org } = await bootstrapOrgWithRoles();
    const mail = new InMemoryMailAdapter();
    const { invitation } = await createInvitation(
      prisma,
      mail,
      { id: admin.id, name: admin.name },
      org.id,
      { email: "newcomer@example.test", role: "Editor" },
      { appBaseUrl: APP_BASE_URL, ttlDays: INVITE_TTL_DAYS },
    );
    expect(invitation.status).toBe("Pending");
    const cancelled = await cancelInvitation(prisma, admin.id, org.id, invitation.id);
    expect(cancelled.status).toBe("Revoked");
  });

  it("guessed membershipId on the admin role wrapper is NOT_FOUND", async () => {
    const { admin, org } = await bootstrapOrgWithRoles();
    await expectApiError(
      changeRole(prisma, admin.id, org.id, "00000000-0000-0000-0000-000000000000", {
        role: "Editor",
      }),
      "NOT_FOUND",
    );
  });

  it("guessed invitationId on the admin cancel wrapper is NOT_FOUND", async () => {
    const { admin, org } = await bootstrapOrgWithRoles();
    await expectApiError(
      cancelInvitation(prisma, admin.id, org.id, "00000000-0000-0000-0000-000000000000"),
      "NOT_FOUND",
    );
  });
});
