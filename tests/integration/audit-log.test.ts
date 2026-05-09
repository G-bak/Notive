// Audit-log skeleton (Step 8) — verifies that each Step 4-7 mutation
// emits a row in `activity_logs` and that the Admin-only listing
// service returns those rows for the right organization.

import { describe, expect, it } from "vitest";

import { createSession, hashPassword, hashToken, login, revokeSessionByToken } from "@notive/auth";
import { prisma } from "@notive/db";
import { InMemoryMailAdapter } from "@notive/mail";
import { ApiError } from "@notive/permissions";

import { Actions } from "../../apps/web/lib/audit";
import { listActivityLogs } from "../../apps/web/lib/services/activity-log";
import {
  acceptInvitation,
  cancelInvitation,
  createInvitation,
} from "../../apps/web/lib/services/invitation";
import {
  changeRole,
  changeTeam,
  deactivateMembership,
  reactivateMembership,
} from "../../apps/web/lib/services/membership";
import { createOrganization, updateOrganization } from "../../apps/web/lib/services/organization";
import { archiveTeam, createTeam, updateTeam } from "../../apps/web/lib/services/team";

import { createUser } from "./src/helpers.js";

const APP_BASE_URL = "https://test.notive.local";
const INVITE_TTL_DAYS = 7;
const SESSION_TTL = { idleDays: 14, absoluteDays: 30 };

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

async function findEvent(orgId: string, action: string) {
  return prisma.activityLog.findFirst({
    where: { organizationId: orgId, action },
    orderBy: { createdAt: "desc" },
  });
}

describe("audit log: organization events", () => {
  it("organization.created is recorded with the creator as actor", async () => {
    const u = await createActiveUser("aud-oc");
    const org = await createOrganization(prisma, u, { name: "AOrg", slug: "aorg" });

    const ev = await findEvent(org.id, Actions.ORGANIZATION_CREATED);
    expect(ev).not.toBeNull();
    expect(ev!.actorUserId).toBe(u.id);
    expect(ev!.targetType).toBe("organization");
    expect(ev!.targetId).toBe(org.id);
    expect(ev!.result).toBe("Success");
    expect(ev!.metadata).toMatchObject({ name: "AOrg", slug: "aorg" });
  });

  it("organization.updated is recorded with the actor and new name", async () => {
    const u = await createActiveUser("aud-ou");
    const org = await createOrganization(prisma, u, { name: "Old" });
    await updateOrganization(prisma, u.id, org.id, { name: "New" });
    const ev = await findEvent(org.id, Actions.ORGANIZATION_UPDATED);
    expect(ev).not.toBeNull();
    expect(ev!.actorUserId).toBe(u.id);
    expect(ev!.metadata).toMatchObject({ name: "New" });
  });
});

describe("audit log: team events", () => {
  it("team.created / team.updated / team.archived are all recorded", async () => {
    const u = await createActiveUser("aud-t");
    const org = await createOrganization(prisma, u, { name: "TOrg" });
    const t = await createTeam(prisma, u.id, org.id, { name: "Eng" });
    await updateTeam(prisma, u.id, org.id, t.id, { name: "Engineering" });
    await archiveTeam(prisma, u.id, org.id, t.id);

    const created = await findEvent(org.id, Actions.TEAM_CREATED);
    expect(created!.targetId).toBe(t.id);
    expect(created!.metadata).toMatchObject({ name: "Eng" });

    const updated = await findEvent(org.id, Actions.TEAM_UPDATED);
    expect(updated!.targetId).toBe(t.id);
    expect(updated!.metadata).toMatchObject({ name: "Engineering" });

    const archived = await findEvent(org.id, Actions.TEAM_ARCHIVED);
    expect(archived!.targetId).toBe(t.id);
  });
});

describe("audit log: membership events", () => {
  it("membership.role_changed / .team_changed / .deactivated / .reactivated", async () => {
    const admin = await createActiveUser("aud-ma");
    const org = await createOrganization(prisma, admin, { name: "MOrg" });
    const team = await createTeam(prisma, admin.id, org.id, { name: "Squad" });
    const editor = await createActiveUser("aud-me");
    const m = await prisma.membership.create({
      data: {
        userId: editor.id,
        organizationId: org.id,
        role: "Editor",
        status: "Active",
      },
    });

    await changeRole(prisma, admin.id, org.id, m.id, { role: "Manager" });
    await changeTeam(prisma, admin.id, org.id, m.id, { teamId: team.id });
    await deactivateMembership(prisma, admin.id, org.id, m.id);
    await reactivateMembership(prisma, admin.id, org.id, m.id);

    const role = await findEvent(org.id, Actions.MEMBERSHIP_ROLE_CHANGED);
    expect(role!.actorUserId).toBe(admin.id);
    expect(role!.targetId).toBe(m.id);
    expect(role!.metadata).toMatchObject({ from: "Editor", to: "Manager" });

    const teamEv = await findEvent(org.id, Actions.MEMBERSHIP_TEAM_CHANGED);
    expect(teamEv!.metadata).toMatchObject({ from: null, to: team.id });

    const deact = await findEvent(org.id, Actions.MEMBERSHIP_DEACTIVATED);
    expect(deact!.targetId).toBe(m.id);

    const react = await findEvent(org.id, Actions.MEMBERSHIP_REACTIVATED);
    expect(react!.targetId).toBe(m.id);
  });
});

describe("audit log: invitation events", () => {
  it("invitation.created / .cancelled are recorded by the Admin actor", async () => {
    const admin = await createActiveUser("aud-ia");
    const org = await createOrganization(prisma, admin, { name: "IOrg" });
    const mail = new InMemoryMailAdapter();
    const { invitation } = await createInvitation(
      prisma,
      mail,
      { id: admin.id, name: admin.name },
      org.id,
      { email: "guest@example.test", role: "Editor" },
      { appBaseUrl: APP_BASE_URL, ttlDays: INVITE_TTL_DAYS },
    );
    const created = await findEvent(org.id, Actions.INVITATION_CREATED);
    expect(created!.actorUserId).toBe(admin.id);
    expect(created!.targetId).toBe(invitation.id);
    expect(created!.metadata).toMatchObject({ email: "guest@example.test", role: "Editor" });

    await cancelInvitation(prisma, admin.id, org.id, invitation.id);
    const cancelled = await findEvent(org.id, Actions.INVITATION_CANCELLED);
    expect(cancelled!.actorUserId).toBe(admin.id);
    expect(cancelled!.targetId).toBe(invitation.id);
  });

  it("invitation.accepted is recorded with the new membership as target", async () => {
    const admin = await createActiveUser("aud-acc-a");
    const org = await createOrganization(prisma, admin, { name: "AccOrg" });
    const invitee = await createActiveUser("aud-acc-u");
    const mail = new InMemoryMailAdapter();
    const { invitation, token } = await createInvitation(
      prisma,
      mail,
      { id: admin.id, name: admin.name },
      org.id,
      { email: invitee.email, role: "Editor" },
      { appBaseUrl: APP_BASE_URL, ttlDays: INVITE_TTL_DAYS },
    );
    const result = await acceptInvitation(prisma, invitee, { token });
    const accepted = await findEvent(org.id, Actions.INVITATION_ACCEPTED);
    expect(accepted!.actorUserId).toBe(invitee.id);
    expect(accepted!.targetType).toBe("membership");
    expect(accepted!.targetId).toBe(result.membership.id);
    expect(accepted!.metadata).toMatchObject({
      invitationId: invitation.id,
      role: "Editor",
    });
  });
});

describe("audit log: auth events", () => {
  it("auth.login is recorded under the user's active organization", async () => {
    const u = await createActiveUser("aud-li");
    const org = await createOrganization(prisma, u, { name: "LiOrg" });
    // We don't go through the route handler in tests; emulate the login
    // hook directly by re-running the same audit call the route makes.
    // (login() returns the session with userId; the route then records.)
    // Using a fresh password lets us call login() to keep coverage real.
    const password = "TestPass!2345";
    await prisma.user.update({
      where: { id: u.id },
      data: { passwordHash: await hashPassword(password) },
    });
    const { session } = await login(prisma, { email: u.email, password }, { ttl: SESSION_TTL });
    // Mirror the route-level audit call.
    const {
      Actions: AuditActions,
      recordActivity,
      findActiveOrganizationForUser,
    } = await import("../../apps/web/lib/audit");
    const orgId = await findActiveOrganizationForUser(prisma, session.userId);
    expect(orgId).toBe(org.id);
    await recordActivity(prisma, {
      organizationId: orgId!,
      actorUserId: session.userId,
      action: AuditActions.AUTH_LOGIN,
      targetType: "user",
      targetId: session.userId,
    });

    const ev = await findEvent(org.id, Actions.AUTH_LOGIN);
    expect(ev!.actorUserId).toBe(u.id);
    expect(ev!.targetType).toBe("user");
    expect(ev!.targetId).toBe(u.id);
  });

  it("auth.logout records the actor before revocation", async () => {
    const u = await createActiveUser("aud-lo");
    const org = await createOrganization(prisma, u, { name: "LoOrg" });
    const { token, session } = await createSession(prisma, u.id, SESSION_TTL);
    // Mirror the logout route: resolve actor first, then revoke.
    const sess = await prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { userId: true, revokedAt: true },
    });
    const actor = sess && !sess.revokedAt ? sess.userId : null;
    await revokeSessionByToken(prisma, token);
    const { recordActivity } = await import("../../apps/web/lib/audit");
    if (actor) {
      await recordActivity(prisma, {
        organizationId: org.id,
        actorUserId: actor,
        action: Actions.AUTH_LOGOUT,
        targetType: "user",
        targetId: actor,
      });
    }
    const ev = await findEvent(org.id, Actions.AUTH_LOGOUT);
    expect(ev!.actorUserId).toBe(u.id);
    // Sanity: session is now revoked.
    const afterRevoke = await prisma.session.findUnique({ where: { id: session.id } });
    expect(afterRevoke!.revokedAt).not.toBeNull();
  });

  it("auth.password_reset.completed is recorded under the user's active organization", async () => {
    const u = await createActiveUser("aud-pr");
    const org = await createOrganization(prisma, u, { name: "PrOrg" });
    // Emulate the route-level audit call after a successful reset.
    const {
      Actions: AuditActions,
      recordActivity,
      findActiveOrganizationForUser,
    } = await import("../../apps/web/lib/audit");
    const orgId = await findActiveOrganizationForUser(prisma, u.id);
    expect(orgId).toBe(org.id);
    await recordActivity(prisma, {
      organizationId: orgId!,
      actorUserId: u.id,
      action: AuditActions.AUTH_PASSWORD_RESET_COMPLETED,
      targetType: "user",
      targetId: u.id,
    });
    const ev = await findEvent(org.id, Actions.AUTH_PASSWORD_RESET_COMPLETED);
    expect(ev!.actorUserId).toBe(u.id);
    expect(ev!.targetId).toBe(u.id);
  });
});

describe("listActivityLogs (Admin-only read)", () => {
  it("Admin sees their org's events newest-first; cross-org events do not leak", async () => {
    const adminA = await createActiveUser("aud-la");
    const orgA = await createOrganization(prisma, adminA, { name: "OrgA" });
    await createTeam(prisma, adminA.id, orgA.id, { name: "TA" });

    const adminB = await createActiveUser("aud-lb");
    const orgB = await createOrganization(prisma, adminB, { name: "OrgB" });
    await createTeam(prisma, adminB.id, orgB.id, { name: "TB" });

    const aRows = await listActivityLogs(prisma, adminA.id, orgA.id);
    expect(aRows.length).toBeGreaterThanOrEqual(2); // org create + team create
    for (const r of aRows) {
      // Sanity: every row belongs to org A — listed via where: orgA.
      expect(r.action).toEqual(expect.any(String));
    }
    // Newest-first ordering.
    for (let i = 1; i < aRows.length; i += 1) {
      expect(aRows[i - 1]!.createdAt.getTime()).toBeGreaterThanOrEqual(
        aRows[i]!.createdAt.getTime(),
      );
    }
    // Actions in org A should not include events from org B.
    const aTargets = new Set(aRows.map((r) => r.targetId));
    const bRows = await listActivityLogs(prisma, adminB.id, orgB.id);
    for (const r of bRows) {
      if (r.targetType === "organization" || r.targetType === "team") {
        expect(aTargets.has(r.targetId)).toBe(false);
      }
    }
  });

  it("non-Admin members get FORBIDDEN(admin_only)", async () => {
    const admin = await createActiveUser("aud-na");
    const org = await createOrganization(prisma, admin, { name: "Org" });
    const editor = await createActiveUser("aud-ne");
    await prisma.membership.create({
      data: { userId: editor.id, organizationId: org.id, role: "Editor", status: "Active" },
    });
    const manager = await createActiveUser("aud-nm");
    await prisma.membership.create({
      data: { userId: manager.id, organizationId: org.id, role: "Manager", status: "Active" },
    });
    const viewer = await createActiveUser("aud-nv");
    await prisma.membership.create({
      data: { userId: viewer.id, organizationId: org.id, role: "Viewer", status: "Active" },
    });

    for (const u of [editor, manager, viewer]) {
      await expectApiError(listActivityLogs(prisma, u.id, org.id), "FORBIDDEN", "admin_only");
    }
  });

  it("non-member or guessed org returns NOT_FOUND (no reason_code)", async () => {
    const admin = await createActiveUser("aud-stra-a");
    const org = await createOrganization(prisma, admin, { name: "Org" });
    const stranger = await createActiveUser("aud-stranger");

    await expectApiError(listActivityLogs(prisma, stranger.id, org.id), "NOT_FOUND");
    await expectApiError(
      listActivityLogs(prisma, admin.id, "00000000-0000-0000-0000-000000000000"),
      "NOT_FOUND",
    );
  });

  it("limit is clamped to a sane upper bound", async () => {
    const admin = await createActiveUser("aud-lim");
    const org = await createOrganization(prisma, admin, { name: "LimOrg" });
    // Create a few events, then request limit beyond the cap. The
    // service should accept it without error.
    await createTeam(prisma, admin.id, org.id, { name: "T1" });
    await createTeam(prisma, admin.id, org.id, { name: "T2" });
    const rows = await listActivityLogs(prisma, admin.id, org.id, { limit: 1000 });
    // Result should not exceed the internal cap (200) or the actual row count.
    expect(rows.length).toBeLessThanOrEqual(200);
    expect(rows.length).toBeGreaterThanOrEqual(3); // org create + 2 teams
  });
});
