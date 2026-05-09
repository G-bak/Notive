// Minimal permission helpers for Step 5 routes.
//
// Step 6 (`packages/permissions`) will own the real permission matrix.
// For now we keep the rules right next to the routes that need them
// to avoid a premature abstraction, but everything goes through these
// helpers so Step 6 can lift them with minimal churn.
//
// Phase A / Phase B locks reflected here:
//   - Cross-org or hidden lookups -> NOT_FOUND (no reason_code).
//   - Authenticated but feature-not-permitted -> FORBIDDEN(reason_code).
//   - Manager cannot invite, cannot manage templates, cannot enter the
//     B-stage admin API surface (Phase B only).
//   - Admin actions are exclusive to membership.role === "Admin".

import type { Membership, PrismaClient, RoleCode } from "@notive/db";

import { ApiError, Errors } from "./api-error";

/**
 * Resolve the requesting user's Active membership for the given org.
 * Throws NOT_FOUND if the org does not exist or the user is not an
 * active member — the two cases are deliberately indistinguishable.
 */
export async function requireMembership(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
): Promise<Membership> {
  const m = await prisma.membership.findFirst({
    where: {
      userId,
      organizationId,
      status: "Active",
      deletedAt: null,
    },
  });
  if (!m) {
    throw Errors.notFound();
  }
  return m;
}

/** Throws FORBIDDEN(reason) unless the membership has the Admin role. */
export function requireAdmin(membership: Membership, reason = "admin_only"): void {
  if (membership.role !== "Admin") {
    throw Errors.forbidden(reason);
  }
}

const ROLE_ORDER: RoleCode[] = ["Viewer", "Editor", "Manager", "Admin"];

export function roleAtLeast(role: RoleCode, minimum: RoleCode): boolean {
  return ROLE_ORDER.indexOf(role) >= ROLE_ORDER.indexOf(minimum);
}

/**
 * Application-level last-Admin protection.
 *
 * The DB trigger `check_last_admin` is the authoritative guard, but the
 * instruction (Step 5 §8) requires the same rule at the API layer so
 * the response is FORBIDDEN(last_admin_protection) instead of a raw
 * Postgres error. Call this BEFORE issuing the SQL that would demote,
 * deactivate, soft-delete, or transfer the row.
 *
 * Covers the four cases:
 *   - role change away from Admin
 *   - status change to Disabled / Removed
 *   - soft-delete (deletedAt set)
 *   - org transfer (organizationId change — never exposed by Step 5
 *     APIs, but we guard anyway)
 */
export async function assertNotLastAdmin(
  prisma: PrismaClient,
  membership: Pick<Membership, "id" | "organizationId" | "role">,
): Promise<void> {
  if (membership.role !== "Admin") {
    return;
  }
  const otherActiveAdmins = await prisma.membership.count({
    where: {
      organizationId: membership.organizationId,
      role: "Admin",
      status: "Active",
      deletedAt: null,
      NOT: { id: membership.id },
    },
  });
  if (otherActiveAdmins === 0) {
    throw new ApiError("FORBIDDEN", { reason: "last_admin_protection" });
  }
}
