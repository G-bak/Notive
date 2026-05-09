// Organization service.
//
// Phase A §15 locks reflected here:
//   - 1 user = 1 active organization membership. Creating an org makes
//     the creator an Admin member, so a user with an existing active
//     membership cannot create a new org.
//   - Pending / Disabled / Deleted users cannot create an org. Session
//     validation already rejects non-Active users, so this is implicit
//     at the route layer; we re-assert it in the service for safety.
//   - Org creation seeds an `organization_settings` row with the
//     default role ("Editor"), per Step 5 §6.
//
// `slug` is unique across all orgs (Phase B). We accept a slug from the
// caller so it is reproducible in tests; if omitted, derive from the
// name. Slug uniqueness collisions return CONFLICT(slug_taken).

import type { Organization, PrismaClient, User } from "@notive/db";
import { Errors, requireActiveUser, requireAdmin, requireMembership } from "@notive/permissions";
import { z } from "zod";

export const createOrganizationInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
      "slug must be lowercase letters, digits, and dashes",
    )
    .optional(),
});

export const updateOrganizationInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
  })
  .refine((d: { name?: string }) => d.name !== undefined, "no fields to update");

function defaultSlugFromName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (base.length < 2) {
    return `org-${Date.now().toString(36)}`;
  }
  return base;
}

export async function createOrganization(
  prisma: PrismaClient,
  user: Pick<User, "id" | "status">,
  rawInput: unknown,
): Promise<Organization> {
  // Defense in depth — session validation already enforces this.
  requireActiveUser(user);
  const parsed = createOrganizationInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw Errors.invalid(parsed.error.issues[0]?.message ?? "invalid input");
  }
  const slug = parsed.data.slug ?? defaultSlugFromName(parsed.data.name);

  // 1 user = 1 active membership. Pre-check before creating to return
  // a clean CONFLICT instead of a raw unique-violation.
  const existing = await prisma.membership.findFirst({
    where: { userId: user.id, status: "Active", deletedAt: null },
  });
  if (existing) {
    throw Errors.conflict("already_in_organization");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: parsed.data.name,
          slug,
          createdByUserId: user.id,
        },
      });
      await tx.membership.create({
        data: {
          userId: user.id,
          organizationId: org.id,
          role: "Admin",
          status: "Active",
        },
      });
      await tx.organizationSetting.create({
        data: { organizationId: org.id },
      });
      return org;
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw Errors.conflict("slug_taken");
    }
    throw err;
  }
}

export async function getOrganization(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
): Promise<Organization> {
  // Membership check first; cross-org access returns NOT_FOUND.
  await requireMembership(prisma, userId, organizationId);
  const org = await prisma.organization.findFirst({
    where: { id: organizationId, deletedAt: null },
  });
  if (!org) {
    throw Errors.notFound();
  }
  return org;
}

export async function updateOrganization(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  rawInput: unknown,
): Promise<Organization> {
  const membership = await requireMembership(prisma, userId, organizationId);
  requireAdmin(membership);
  const parsed = updateOrganizationInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw Errors.invalid(parsed.error.issues[0]?.message ?? "invalid input");
  }
  return prisma.organization.update({
    where: { id: organizationId },
    data: { name: parsed.data.name },
  });
}

function isUniqueConstraintError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) {
    return false;
  }
  return (err as { code?: unknown }).code === "P2002";
}
