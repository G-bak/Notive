// Permission Module — runtime checks.
//
// These functions are the single source of truth for who-can-do-what
// in Phase B. Step 5 services call into them directly; Step 7+ admin
// routes will reuse the same primitives. Step 6 lifted them out of
// `apps/web/lib/permissions.ts` without changing their semantics.
//
// Phase A / Phase B locks reflected here:
//
//   - 1 user = 1 active organization membership.
//   - 1 user = 1 primary team via memberships.team_id.
//   - Manager cannot invite, cannot manage templates, cannot enter the
//     B-stage admin API. Only Admin may run any management mutation.
//   - Last-Admin protection applies to demotion / disable / soft-delete
//     / org transfer of the sole active Admin row.
//
// Error policy (§15):
//
//   - Cross-org / hidden / id-guess        -> NOT_FOUND
//   - Authenticated-but-feature-not-allowed -> FORBIDDEN(reason_code)
//   - Last-Admin protection                 -> FORBIDDEN(last_admin_protection)

import type { Membership, PrismaClient, RoleCode } from "@notive/db";

import { ApiError, Errors } from "./errors.js";

const ROLE_ORDER: RoleCode[] = ["Viewer", "Editor", "Manager", "Admin"];

/** Numeric comparator over the system roles. Admin > Manager > Editor > Viewer. */
export function roleAtLeast(role: RoleCode, minimum: RoleCode): boolean {
  return ROLE_ORDER.indexOf(role) >= ROLE_ORDER.indexOf(minimum);
}

/**
 * Resolve the requesting user's Active membership for the given org.
 * Throws NOT_FOUND if the org does not exist or the user is not an
 * active member — the two cases are deliberately indistinguishable so
 * the response cannot be used to prove a foreign org's existence.
 *
 * Soft-deleted memberships (`deletedAt != null`) and non-Active
 * statuses do not count as membership.
 */
export async function requireMembership(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
): Promise<Membership> {
  const m = await prisma.membership.findFirst({
    where: { userId, organizationId, status: "Active", deletedAt: null },
  });
  if (!m) {
    throw Errors.notFound();
  }
  return m;
}

/**
 * Throws FORBIDDEN(reason) unless the membership has the Admin role.
 * Default reason is `admin_only`. Specialized callers (notably
 * invitation creation) override it to `manager_cannot_invite` so the
 * client can see *why* their role was rejected.
 *
 * Phase A §15: Manager is locked out of every B-stage management API.
 * The Manager-specific reason code makes that policy explicit.
 */
export function requireAdmin(
  membership: Pick<Membership, "role">,
  reason: string = "admin_only",
): void {
  if (membership.role !== "Admin") {
    throw Errors.forbidden(reason);
  }
}

/**
 * Reject a non-Active actor at the service boundary even when a
 * session is present. Session validation already filters out non-Active
 * users, so this is defense-in-depth — useful when the actor object is
 * passed in from a non-session source (e.g. a future cron / admin
 * impersonation flow).
 */
export function requireActiveUser(user: { status: string }): void {
  if (user.status !== "Active") {
    throw Errors.forbidden("account_not_active");
  }
}

/**
 * Application-level last-Admin protection.
 *
 * The DB trigger `check_last_admin` is the authoritative guard — it
 * RAISEs on UPDATE/DELETE that would leave 0 active Admins. Calling
 * this helper *before* the SQL keeps the user-visible error clean and
 * consistent: the response is FORBIDDEN(last_admin_protection) instead
 * of a raw Postgres P0001.
 *
 * Covers four shapes of change (Phase B step 6 §8):
 *   - role change away from Admin
 *   - status change to Disabled / Removed
 *   - soft-delete (deletedAt set)
 *   - org transfer (organizationId change — never exposed by Step 5
 *     APIs; we still guard for future routes)
 *
 * No-op when the membership is not currently Admin.
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
