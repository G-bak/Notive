// Org / Team / Membership / Invitation flow against the real Postgres.
// Drives the service functions directly (no Next.js boot) so we can
// assert DB state precisely.

import { describe, expect, it } from "vitest";

import { ApiError } from "@notive/permissions";
import {
  acceptInvitation,
  cancelInvitation,
  createInvitation,
  listInvitations,
} from "../../apps/web/lib/services/invitation";
import {
  changeRole,
  changeTeam,
  deactivateMembership,
  listMemberships,
  reactivateMembership,
} from "../../apps/web/lib/services/membership";
import {
  createOrganization,
  getOrganization,
  updateOrganization,
} from "../../apps/web/lib/services/organization";
import { archiveTeam, createTeam, listTeams, updateTeam } from "../../apps/web/lib/services/team";
import { prisma } from "@notive/db";
import { InMemoryMailAdapter } from "@notive/mail";

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
  // helpers.createUser already sets status: Active and emailVerifiedAt.
  const full = await prisma.user.findUnique({ where: { id: u.id } });
  return {
    id: full!.id,
    email: full!.email,
    name: full!.name,
    status: "Active",
  };
}

async function createPendingUser(name: string): Promise<{ id: string; email: string }> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const u = await prisma.user.create({
    data: {
      name: `${name} ${suffix}`,
      email: `${name}-${suffix}@example.test`,
      passwordHash: "x",
      status: "Pending",
    },
  });
  return { id: u.id, email: u.email };
}

async function expectApiError(
  promise: Promise<unknown>,
  code: ApiError["code"],
  reason?: string,
): Promise<void> {
  await expect(promise).rejects.toMatchObject(reason !== undefined ? { code, reason } : { code });
}

describe("organization create / get / update", () => {
  it("Active user can create an organization and is auto-Admin with org_settings", async () => {
    const u = await createActiveUser("creator");
    const org = await createOrganization(prisma, u, { name: "Acme", slug: "acme-co" });

    expect(org.name).toBe("Acme");
    expect(org.slug).toBe("acme-co");

    const ms = await prisma.membership.findMany({ where: { userId: u.id } });
    expect(ms).toHaveLength(1);
    expect(ms[0]!.role).toBe("Admin");
    expect(ms[0]!.status).toBe("Active");
    expect(ms[0]!.organizationId).toBe(org.id);

    const settings = await prisma.organizationSetting.findUnique({
      where: { organizationId: org.id },
    });
    expect(settings).not.toBeNull();
    expect(settings!.defaultRole).toBe("Editor");
  });

  it("Pending user cannot create an organization", async () => {
    const u = await createPendingUser("pending");
    await expectApiError(
      createOrganization(prisma, { id: u.id, status: "Pending" }, { name: "PendingCo" }),
      "FORBIDDEN",
      "account_not_active",
    );
  });

  it("Disabled user cannot create an organization", async () => {
    const u = await createActiveUser("dis");
    await prisma.user.update({ where: { id: u.id }, data: { status: "Disabled" } });
    await expectApiError(
      createOrganization(prisma, { id: u.id, status: "Disabled" }, { name: "DisCo" }),
      "FORBIDDEN",
      "account_not_active",
    );
  });

  it("user with an existing active membership cannot create a second org", async () => {
    const u = await createActiveUser("dup");
    await createOrganization(prisma, u, { name: "First" });
    await expectApiError(
      createOrganization(prisma, u, { name: "Second" }),
      "CONFLICT",
      "already_in_organization",
    );
  });

  it("getOrganization returns NOT_FOUND for a non-member (no org leak)", async () => {
    const owner = await createActiveUser("owner");
    const other = await createActiveUser("nosy");
    const org = await createOrganization(prisma, owner, { name: "Locked" });
    await expectApiError(getOrganization(prisma, other.id, org.id), "NOT_FOUND");
  });

  it("getOrganization returns NOT_FOUND for a guessed/random id", async () => {
    const u = await createActiveUser("get");
    await expectApiError(
      getOrganization(prisma, u.id, "00000000-0000-0000-0000-000000000000"),
      "NOT_FOUND",
    );
  });

  it("only Admin can update the organization name", async () => {
    const admin = await createActiveUser("ad");
    const org = await createOrganization(prisma, admin, { name: "Old" });
    const editor = await createActiveUser("ed");
    await prisma.membership.create({
      data: {
        userId: editor.id,
        organizationId: org.id,
        role: "Editor",
        status: "Active",
      },
    });
    await expectApiError(
      updateOrganization(prisma, editor.id, org.id, { name: "Edited" }),
      "FORBIDDEN",
      "admin_only",
    );
    const updated = await updateOrganization(prisma, admin.id, org.id, { name: "Updated" });
    expect(updated.name).toBe("Updated");
  });
});

describe("team CRUD + archive", () => {
  it("admin can create / update / archive a team; viewer can list", async () => {
    const admin = await createActiveUser("ta");
    const org = await createOrganization(prisma, admin, { name: "TeamCo" });

    // viewer for listing
    const viewer = await createActiveUser("tv");
    await prisma.membership.create({
      data: {
        userId: viewer.id,
        organizationId: org.id,
        role: "Viewer",
        status: "Active",
      },
    });

    const t1 = await createTeam(prisma, admin.id, org.id, { name: "Engineering" });
    const t2 = await createTeam(prisma, admin.id, org.id, { name: "Design" });

    const teams = await listTeams(prisma, viewer.id, org.id);
    expect(teams.map((t) => t.name).sort()).toEqual(["Design", "Engineering"]);

    const renamed = await updateTeam(prisma, admin.id, org.id, t1.id, {
      name: "Eng",
      description: "core",
    });
    expect(renamed.name).toBe("Eng");
    expect(renamed.description).toBe("core");

    const archived = await archiveTeam(prisma, admin.id, org.id, t2.id);
    expect(archived.status).toBe("Archived");
  });

  it("non-admin cannot create / update / archive teams", async () => {
    const admin = await createActiveUser("xa");
    const org = await createOrganization(prisma, admin, { name: "X" });
    const editor = await createActiveUser("xe");
    await prisma.membership.create({
      data: {
        userId: editor.id,
        organizationId: org.id,
        role: "Editor",
        status: "Active",
      },
    });
    const manager = await createActiveUser("xm");
    await prisma.membership.create({
      data: {
        userId: manager.id,
        organizationId: org.id,
        role: "Manager",
        status: "Active",
      },
    });

    await expectApiError(
      createTeam(prisma, editor.id, org.id, { name: "T" }),
      "FORBIDDEN",
      "admin_only",
    );
    await expectApiError(
      createTeam(prisma, manager.id, org.id, { name: "T" }),
      "FORBIDDEN",
      "admin_only",
    );
  });

  it("cross-org team operations return NOT_FOUND", async () => {
    const a = await createActiveUser("ca");
    const orgA = await createOrganization(prisma, a, { name: "A" });
    const team = await createTeam(prisma, a.id, orgA.id, { name: "T" });
    const b = await createActiveUser("cb");
    const orgB = await createOrganization(prisma, b, { name: "B" });
    // user b is NOT a member of orgA: must look like NOT_FOUND.
    await expectApiError(updateTeam(prisma, b.id, orgA.id, team.id, { name: "X" }), "NOT_FOUND");
    // Also: poking team.id under a different org must return NOT_FOUND.
    await expectApiError(updateTeam(prisma, b.id, orgB.id, team.id, { name: "X" }), "NOT_FOUND");
  });
});

describe("membership role / team / deactivate / reactivate", () => {
  async function bootstrapOrgWithExtras() {
    const admin = await createActiveUser("ma");
    const org = await createOrganization(prisma, admin, { name: "MOrg" });
    const team = await createTeam(prisma, admin.id, org.id, { name: "Squad" });
    const editor = await createActiveUser("me");
    const editorM = await prisma.membership.create({
      data: {
        userId: editor.id,
        organizationId: org.id,
        role: "Editor",
        status: "Active",
      },
    });
    return { admin, org, team, editor, editorM };
  }

  it("admin can change a member's role", async () => {
    const { admin, org, editorM } = await bootstrapOrgWithExtras();
    const updated = await changeRole(prisma, admin.id, org.id, editorM.id, { role: "Manager" });
    expect(updated.role).toBe("Manager");
  });

  it("non-admin cannot change a member's role", async () => {
    const { org, editor, editorM } = await bootstrapOrgWithExtras();
    await expectApiError(
      changeRole(prisma, editor.id, org.id, editorM.id, { role: "Admin" }),
      "FORBIDDEN",
      "admin_only",
    );
  });

  it("non-admin cannot list memberships", async () => {
    const { org, editor } = await bootstrapOrgWithExtras();
    await expectApiError(listMemberships(prisma, editor.id, org.id), "FORBIDDEN", "admin_only");
  });

  it("admin can change a member's primary team and clear it back to null", async () => {
    const { admin, org, team, editorM } = await bootstrapOrgWithExtras();
    const a = await changeTeam(prisma, admin.id, org.id, editorM.id, { teamId: team.id });
    expect(a.teamId).toBe(team.id);
    const b = await changeTeam(prisma, admin.id, org.id, editorM.id, { teamId: null });
    expect(b.teamId).toBeNull();
  });

  it("foreign team id in membership assignment returns NOT_FOUND", async () => {
    const { admin, org, editorM } = await bootstrapOrgWithExtras();
    const foreignAdmin = await createActiveUser("foreign-team-owner");
    const foreignOrg = await createOrganization(prisma, foreignAdmin, { name: "ForeignTeamOrg" });
    const foreignTeam = await createTeam(prisma, foreignAdmin.id, foreignOrg.id, {
      name: "Foreign",
    });

    await expectApiError(
      changeTeam(prisma, admin.id, org.id, editorM.id, { teamId: foreignTeam.id }),
      "NOT_FOUND",
    );
  });

  it("admin can deactivate then reactivate a non-Admin membership", async () => {
    const { admin, org, editorM } = await bootstrapOrgWithExtras();
    const dis = await deactivateMembership(prisma, admin.id, org.id, editorM.id);
    expect(dis.status).toBe("Disabled");
    const re = await reactivateMembership(prisma, admin.id, org.id, editorM.id);
    expect(re.status).toBe("Active");
  });

  it("reactivating a member who has another active membership returns CONFLICT", async () => {
    const { admin, org, editor, editorM } = await bootstrapOrgWithExtras();
    // Disable editor in orgA.
    await deactivateMembership(prisma, admin.id, org.id, editorM.id);
    // Editor creates orgB and is active there.
    const orgB = await createOrganization(
      prisma,
      { id: editor.id, status: "Active" },
      { name: "EditorOrg" },
    );
    expect(orgB.id).not.toBe(org.id);
    // Now try to reactivate the disabled membership in orgA.
    await expectApiError(
      reactivateMembership(prisma, admin.id, org.id, editorM.id),
      "CONFLICT",
      "already_in_organization",
    );
  });

  it("last-Admin protection blocks demotion", async () => {
    const admin = await createActiveUser("la");
    const org = await createOrganization(prisma, admin, { name: "LA" });
    const adminM = (await prisma.membership.findFirst({
      where: { userId: admin.id, organizationId: org.id },
    }))!;
    await expectApiError(
      changeRole(prisma, admin.id, org.id, adminM.id, { role: "Editor" }),
      "FORBIDDEN",
      "last_admin_protection",
    );
  });

  it("last-Admin protection blocks deactivation", async () => {
    const admin = await createActiveUser("ld");
    const org = await createOrganization(prisma, admin, { name: "LD" });
    const adminM = (await prisma.membership.findFirst({
      where: { userId: admin.id, organizationId: org.id },
    }))!;
    await expectApiError(
      deactivateMembership(prisma, admin.id, org.id, adminM.id),
      "FORBIDDEN",
      "last_admin_protection",
    );
  });

  it("demotion is allowed once another active Admin exists", async () => {
    const admin = await createActiveUser("ok");
    const org = await createOrganization(prisma, admin, { name: "OK" });
    const second = await createActiveUser("ok2");
    const secondM = await prisma.membership.create({
      data: {
        userId: second.id,
        organizationId: org.id,
        role: "Admin",
        status: "Active",
      },
    });
    const updated = await changeRole(prisma, admin.id, org.id, secondM.id, { role: "Editor" });
    expect(updated.role).toBe("Editor");
  });

  it("cross-org membership ops are NOT_FOUND, not FORBIDDEN", async () => {
    const a = await createActiveUser("xa1");
    const orgA = await createOrganization(prisma, a, { name: "OrgA" });
    const aM = (await prisma.membership.findFirst({
      where: { userId: a.id, organizationId: orgA.id },
    }))!;
    const b = await createActiveUser("xb1");
    const orgB = await createOrganization(prisma, b, { name: "OrgB" });
    // b is admin of orgB but not a member of orgA. b acting on orgA must be NOT_FOUND.
    await expectApiError(changeRole(prisma, b.id, orgA.id, aM.id, { role: "Editor" }), "NOT_FOUND");
    // Also: real org id but a foreign membershipId — NOT_FOUND.
    await expectApiError(changeRole(prisma, b.id, orgB.id, aM.id, { role: "Editor" }), "NOT_FOUND");
  });
});

describe("invitations", () => {
  // §16.2 "Trying to invite into org B from a user with active
  // membership only in org A is rejected." Cross-org invitation
  // creation must be hidden behind NOT_FOUND, not FORBIDDEN.
  it("Admin of org A cannot create an invitation for org B (NOT_FOUND)", async () => {
    const a = await createActiveUser("xinv-a");
    await createOrganization(prisma, a, { name: "OrgA" });
    const b = await createActiveUser("xinv-b");
    const orgB = await createOrganization(prisma, b, { name: "OrgB" });
    const mail = new InMemoryMailAdapter();
    // a is Admin of OrgA but NOT a member of OrgB. Trying to create an
    // invitation against OrgB must NOT_FOUND, not FORBIDDEN.
    await expectApiError(
      createInvitation(
        prisma,
        mail,
        { id: a.id, name: a.name },
        orgB.id,
        { email: "newcomer@example.test", role: "Editor" },
        { appBaseUrl: APP_BASE_URL, ttlDays: INVITE_TTL_DAYS },
      ),
      "NOT_FOUND",
    );
    expect(mail.messages).toHaveLength(0);
  });

  it("Manager cannot create invitations", async () => {
    const admin = await createActiveUser("ima");
    const org = await createOrganization(prisma, admin, { name: "InvOrg" });
    const manager = await createActiveUser("imm");
    await prisma.membership.create({
      data: {
        userId: manager.id,
        organizationId: org.id,
        role: "Manager",
        status: "Active",
      },
    });
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

  it("foreign team id in invitation creation returns NOT_FOUND", async () => {
    const admin = await createActiveUser("ifta");
    const org = await createOrganization(prisma, admin, { name: "InviteTeamOrg" });
    const foreignAdmin = await createActiveUser("iftf");
    const foreignOrg = await createOrganization(prisma, foreignAdmin, { name: "InviteForeignOrg" });
    const foreignTeam = await createTeam(prisma, foreignAdmin.id, foreignOrg.id, {
      name: "ForeignTeam",
    });
    const mail = new InMemoryMailAdapter();

    await expectApiError(
      createInvitation(
        prisma,
        mail,
        { id: admin.id, name: admin.name },
        org.id,
        { email: "foreign-team-invite@example.test", role: "Editor", teamId: foreignTeam.id },
        { appBaseUrl: APP_BASE_URL, ttlDays: INVITE_TTL_DAYS },
      ),
      "NOT_FOUND",
    );
  });

  it("Admin can create / list / cancel invitations; mail body contains the raw token", async () => {
    const admin = await createActiveUser("iaa");
    const org = await createOrganization(prisma, admin, { name: "InvOrg2" });
    const mail = new InMemoryMailAdapter();
    const { invitation, token } = await createInvitation(
      prisma,
      mail,
      { id: admin.id, name: admin.name },
      org.id,
      { email: "newcomer@example.test", role: "Editor" },
      { appBaseUrl: APP_BASE_URL, ttlDays: INVITE_TTL_DAYS },
    );
    expect(invitation.status).toBe("Pending");
    expect(mail.messages).toHaveLength(1);
    expect(mail.messages[0]!.text).toContain(token);

    const list = await listInvitations(prisma, admin.id, org.id);
    expect(list).toHaveLength(1);

    const cancelled = await cancelInvitation(prisma, admin.id, org.id, invitation.id);
    expect(cancelled.status).toBe("Revoked");
  });

  it("non-Admin cannot list or cancel invitations", async () => {
    const admin = await createActiveUser("iza");
    const org = await createOrganization(prisma, admin, { name: "InvOrg3" });
    const editor = await createActiveUser("ize");
    await prisma.membership.create({
      data: {
        userId: editor.id,
        organizationId: org.id,
        role: "Editor",
        status: "Active",
      },
    });
    const mail = new InMemoryMailAdapter();
    const { invitation } = await createInvitation(
      prisma,
      mail,
      { id: admin.id, name: admin.name },
      org.id,
      { email: "another@example.test", role: "Editor" },
      { appBaseUrl: APP_BASE_URL, ttlDays: INVITE_TTL_DAYS },
    );
    await expectApiError(listInvitations(prisma, editor.id, org.id), "FORBIDDEN", "admin_only");
    await expectApiError(
      cancelInvitation(prisma, editor.id, org.id, invitation.id),
      "FORBIDDEN",
      "admin_only",
    );
  });

  it("logged-in user accepts their own invitation: membership Active, invitation Accepted", async () => {
    const admin = await createActiveUser("aca");
    const org = await createOrganization(prisma, admin, { name: "AccOrg" });
    const invitee = await createActiveUser("acu");
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
    expect(result.invitation.status).toBe("Accepted");
    expect(result.invitation.acceptedAt).not.toBeNull();
    expect(result.membership.organizationId).toBe(org.id);
    expect(result.membership.role).toBe("Editor");
    expect(result.membership.status).toBe("Active");

    const reread = await prisma.invitation.findUnique({ where: { id: invitation.id } });
    expect(reread!.status).toBe("Accepted");
  });

  it("logged-in user with a different email cannot accept (responds NOT_FOUND)", async () => {
    const admin = await createActiveUser("daa");
    const org = await createOrganization(prisma, admin, { name: "DifOrg" });
    const invitee = await createActiveUser("dau");
    const wrong = await createActiveUser("daw");
    const mail = new InMemoryMailAdapter();
    const { token } = await createInvitation(
      prisma,
      mail,
      { id: admin.id, name: admin.name },
      org.id,
      { email: invitee.email, role: "Editor" },
      { appBaseUrl: APP_BASE_URL, ttlDays: INVITE_TTL_DAYS },
    );
    await expectApiError(acceptInvitation(prisma, wrong, { token }), "NOT_FOUND");
  });

  it("Pending user cannot accept an invitation", async () => {
    const admin = await createActiveUser("paa");
    const org = await createOrganization(prisma, admin, { name: "PenOrg" });
    const pending = await createPendingUser("pen");
    const mail = new InMemoryMailAdapter();
    const { token } = await createInvitation(
      prisma,
      mail,
      { id: admin.id, name: admin.name },
      org.id,
      { email: pending.email, role: "Editor" },
      { appBaseUrl: APP_BASE_URL, ttlDays: INVITE_TTL_DAYS },
    );
    await expectApiError(
      acceptInvitation(
        prisma,
        { id: pending.id, email: pending.email, status: "Pending" } as never,
        { token },
      ),
      "FORBIDDEN",
      "account_not_active",
    );
  });

  it("user already in another active org cannot accept", async () => {
    const adminA = await createActiveUser("aaa");
    const orgA = await createOrganization(prisma, adminA, { name: "OrgAA" });
    const someoneAlreadyJoined = await createActiveUser("ajj");
    await prisma.membership.create({
      data: {
        userId: someoneAlreadyJoined.id,
        organizationId: orgA.id,
        role: "Editor",
        status: "Active",
      },
    });
    const adminB = await createActiveUser("aab");
    const orgB = await createOrganization(prisma, adminB, { name: "OrgBB" });
    const mail = new InMemoryMailAdapter();
    const { token } = await createInvitation(
      prisma,
      mail,
      { id: adminB.id, name: adminB.name },
      orgB.id,
      { email: someoneAlreadyJoined.email, role: "Editor" },
      { appBaseUrl: APP_BASE_URL, ttlDays: INVITE_TTL_DAYS },
    );
    await expectApiError(
      acceptInvitation(prisma, someoneAlreadyJoined, { token }),
      "CONFLICT",
      "already_in_organization",
    );
  });

  it("expired invitation cannot be accepted", async () => {
    const admin = await createActiveUser("eaa");
    const org = await createOrganization(prisma, admin, { name: "EOrg" });
    const invitee = await createActiveUser("eau");
    const mail = new InMemoryMailAdapter();
    const { invitation, token } = await createInvitation(
      prisma,
      mail,
      { id: admin.id, name: admin.name },
      org.id,
      { email: invitee.email, role: "Editor" },
      { appBaseUrl: APP_BASE_URL, ttlDays: INVITE_TTL_DAYS },
    );
    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await expectApiError(
      acceptInvitation(prisma, invitee, { token }),
      "FORBIDDEN",
      "invitation_expired",
    );
    const reread = await prisma.invitation.findUnique({ where: { id: invitation.id } });
    expect(reread!.status).toBe("Expired");
  });

  it("unknown invitation token returns NOT_FOUND (no enumeration)", async () => {
    const u = await createActiveUser("una");
    await expectApiError(
      acceptInvitation(prisma, u, { token: "bogus-token-not-issued" }),
      "NOT_FOUND",
    );
  });
});
