// Membership service.
//
// Phase A §15 locks reflected here:
//   - 1 user = 1 active organization membership. Reactivating a member
//     when they have an active membership in another org returns
//     CONFLICT(already_in_organization) instead of letting the DB
//     unique index produce a raw error.
//   - 1 user = 1 primary team via `memberships.team_id`. Changing team
//     replaces the single column; multi-team join tables are forbidden.
//   - Last-Admin protection (DB trigger + app-level check). The app
//     pre-check returns FORBIDDEN(last_admin_protection); the DB
//     trigger remains the authoritative safety net.
//   - Manager cannot enter B-stage admin API: only Admin may run any
//     of the mutation routes here.

import type { Membership, PrismaClient } from "@notive/db";
import { Errors, assertNotLastAdmin, requireAdmin, requireMembership } from "@notive/permissions";
import { z } from "zod";

import { Actions, recordActivity } from "../audit";

export const changeRoleInputSchema = z.object({
  role: z.enum(["Viewer", "Editor", "Manager", "Admin"]),
});

export const changeTeamInputSchema = z.object({
  teamId: z.string().uuid().nullable(),
});

export async function listMemberships(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
): Promise<Membership[]> {
  const acting = await requireMembership(prisma, userId, organizationId);
  requireAdmin(acting);
  return prisma.membership.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: [{ status: "asc" }, { role: "desc" }, { createdAt: "asc" }],
  });
}

async function loadTargetMembership(
  prisma: PrismaClient,
  organizationId: string,
  membershipId: string,
): Promise<Membership> {
  const m = await prisma.membership.findFirst({
    where: { id: membershipId, organizationId, deletedAt: null },
  });
  if (!m) {
    throw Errors.notFound();
  }
  return m;
}

export async function changeRole(
  prisma: PrismaClient,
  actingUserId: string,
  organizationId: string,
  membershipId: string,
  rawInput: unknown,
): Promise<Membership> {
  const acting = await requireMembership(prisma, actingUserId, organizationId);
  requireAdmin(acting);
  const target = await loadTargetMembership(prisma, organizationId, membershipId);
  const parsed = changeRoleInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw Errors.invalid(parsed.error.issues[0]?.message ?? "invalid role");
  }
  if (parsed.data.role === target.role) {
    return target;
  }
  // If we are demoting an Admin, ensure another active Admin exists.
  if (target.role === "Admin" && parsed.data.role !== "Admin") {
    await assertNotLastAdmin(prisma, target);
  }
  const updated = await prisma.membership.update({
    where: { id: target.id },
    data: { role: parsed.data.role },
  });
  await recordActivity(prisma, {
    organizationId,
    actorUserId: actingUserId,
    action: Actions.MEMBERSHIP_ROLE_CHANGED,
    targetType: "membership",
    targetId: updated.id,
    metadata: { from: target.role, to: updated.role },
  });
  return updated;
}

export async function changeTeam(
  prisma: PrismaClient,
  actingUserId: string,
  organizationId: string,
  membershipId: string,
  rawInput: unknown,
): Promise<Membership> {
  const acting = await requireMembership(prisma, actingUserId, organizationId);
  requireAdmin(acting);
  const target = await loadTargetMembership(prisma, organizationId, membershipId);
  const parsed = changeTeamInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw Errors.invalid(parsed.error.issues[0]?.message ?? "invalid team");
  }
  if (parsed.data.teamId !== null) {
    const team = await prisma.team.findFirst({
      where: { id: parsed.data.teamId, organizationId, deletedAt: null },
    });
    if (!team) {
      throw Errors.notFound();
    }
  }
  const updated = await prisma.membership.update({
    where: { id: target.id },
    data: { teamId: parsed.data.teamId },
  });
  await recordActivity(prisma, {
    organizationId,
    actorUserId: actingUserId,
    action: Actions.MEMBERSHIP_TEAM_CHANGED,
    targetType: "membership",
    targetId: updated.id,
    metadata: { from: target.teamId, to: updated.teamId },
  });
  return updated;
}

export async function deactivateMembership(
  prisma: PrismaClient,
  actingUserId: string,
  organizationId: string,
  membershipId: string,
): Promise<Membership> {
  const acting = await requireMembership(prisma, actingUserId, organizationId);
  requireAdmin(acting);
  const target = await loadTargetMembership(prisma, organizationId, membershipId);
  if (target.status !== "Active") {
    return target;
  }
  // Last-Admin protection: deactivating an Admin must leave at least
  // one other active Admin.
  if (target.role === "Admin") {
    await assertNotLastAdmin(prisma, target);
  }
  const updated = await prisma.membership.update({
    where: { id: target.id },
    data: { status: "Disabled" },
  });
  await recordActivity(prisma, {
    organizationId,
    actorUserId: actingUserId,
    action: Actions.MEMBERSHIP_DEACTIVATED,
    targetType: "membership",
    targetId: updated.id,
  });
  return updated;
}

export async function reactivateMembership(
  prisma: PrismaClient,
  actingUserId: string,
  organizationId: string,
  membershipId: string,
): Promise<Membership> {
  const acting = await requireMembership(prisma, actingUserId, organizationId);
  requireAdmin(acting);
  const target = await loadTargetMembership(prisma, organizationId, membershipId);
  if (target.status === "Active") {
    return target;
  }
  // 1 user = 1 active membership: if the target user already has an
  // active membership somewhere, reject before touching the DB.
  const otherActive = await prisma.membership.findFirst({
    where: {
      userId: target.userId,
      status: "Active",
      deletedAt: null,
      NOT: { id: target.id },
    },
  });
  if (otherActive) {
    throw Errors.conflict("already_in_organization");
  }
  const updated = await prisma.membership.update({
    where: { id: target.id },
    data: { status: "Active" },
  });
  await recordActivity(prisma, {
    organizationId,
    actorUserId: actingUserId,
    action: Actions.MEMBERSHIP_REACTIVATED,
    targetType: "membership",
    targetId: updated.id,
  });
  return updated;
}
