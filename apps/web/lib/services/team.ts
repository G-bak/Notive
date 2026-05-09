// Team service.
//
// Phase A §15 lock: there are no Departments, no multi-team join
// tables. Teams live within a single org and may have a parent team
// (forming a tree). Membership.team_id is a single column (Phase B
// primary-team lock); this service does not touch that here — it
// only manages Team rows. Membership team assignment lives in
// `services/membership.ts`.
//
// Admin-only mutations: create / update / archive. Listing is open to
// any active member of the org.

import type { PrismaClient, Team } from "@notive/db";
import { z } from "zod";

import { Errors } from "../api-error";
import { requireAdmin, requireMembership } from "../permissions";

const teamNameSchema = z.string().trim().min(1).max(120);

export const createTeamInputSchema = z.object({
  name: teamNameSchema,
  description: z.string().trim().max(2000).optional().nullable(),
  parentTeamId: z.string().uuid().optional().nullable(),
  managerUserId: z.string().uuid().optional().nullable(),
});

interface UpdateTeamShape {
  name?: string;
  description?: string | null;
  parentTeamId?: string | null;
  managerUserId?: string | null;
}

export const updateTeamInputSchema = z
  .object({
    name: teamNameSchema.optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    parentTeamId: z.string().uuid().nullable().optional(),
    managerUserId: z.string().uuid().nullable().optional(),
  })
  .refine(
    (d: UpdateTeamShape) =>
      d.name !== undefined ||
      d.description !== undefined ||
      d.parentTeamId !== undefined ||
      d.managerUserId !== undefined,
    "no fields to update",
  );

export async function listTeams(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
): Promise<Team[]> {
  await requireMembership(prisma, userId, organizationId);
  return prisma.team.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });
}

export async function createTeam(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  rawInput: unknown,
): Promise<Team> {
  const membership = await requireMembership(prisma, userId, organizationId);
  requireAdmin(membership);
  const parsed = createTeamInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw Errors.invalid(parsed.error.issues[0]?.message ?? "invalid input");
  }
  if (parsed.data.parentTeamId) {
    await assertTeamInOrg(prisma, parsed.data.parentTeamId, organizationId);
  }
  if (parsed.data.managerUserId) {
    await assertActiveMember(prisma, parsed.data.managerUserId, organizationId);
  }
  return prisma.team.create({
    data: {
      organizationId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      parentTeamId: parsed.data.parentTeamId ?? null,
      managerUserId: parsed.data.managerUserId ?? null,
    },
  });
}

export async function updateTeam(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  teamId: string,
  rawInput: unknown,
): Promise<Team> {
  const membership = await requireMembership(prisma, userId, organizationId);
  requireAdmin(membership);
  const team = await prisma.team.findFirst({
    where: { id: teamId, organizationId, deletedAt: null },
  });
  if (!team) {
    throw Errors.notFound();
  }
  const parsed = updateTeamInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw Errors.invalid(parsed.error.issues[0]?.message ?? "invalid input");
  }
  if (parsed.data.parentTeamId !== undefined && parsed.data.parentTeamId !== null) {
    if (parsed.data.parentTeamId === teamId) {
      throw Errors.invalid("team cannot be its own parent");
    }
    await assertTeamInOrg(prisma, parsed.data.parentTeamId, organizationId);
  }
  if (parsed.data.managerUserId !== undefined && parsed.data.managerUserId !== null) {
    await assertActiveMember(prisma, parsed.data.managerUserId, organizationId);
  }

  return prisma.team.update({
    where: { id: teamId },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      ...(parsed.data.parentTeamId !== undefined ? { parentTeamId: parsed.data.parentTeamId } : {}),
      ...(parsed.data.managerUserId !== undefined
        ? { managerUserId: parsed.data.managerUserId }
        : {}),
    },
  });
}

export async function archiveTeam(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  teamId: string,
): Promise<Team> {
  const membership = await requireMembership(prisma, userId, organizationId);
  requireAdmin(membership);
  const team = await prisma.team.findFirst({
    where: { id: teamId, organizationId, deletedAt: null },
  });
  if (!team) {
    throw Errors.notFound();
  }
  if (team.status === "Archived") {
    return team;
  }
  return prisma.team.update({
    where: { id: teamId },
    data: { status: "Archived" },
  });
}

async function assertTeamInOrg(
  prisma: PrismaClient,
  teamId: string,
  organizationId: string,
): Promise<void> {
  const t = await prisma.team.findFirst({
    where: { id: teamId, organizationId, deletedAt: null },
  });
  if (!t) {
    throw Errors.notFound();
  }
}

async function assertActiveMember(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
): Promise<void> {
  const m = await prisma.membership.findFirst({
    where: { userId, organizationId, status: "Active", deletedAt: null },
  });
  if (!m) {
    throw Errors.notFound();
  }
}
