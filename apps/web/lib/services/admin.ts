// Admin skeleton service.
//
// Phase B step 7 builds the *server-side* surface for the future
// admin UI. No React pages are added in this step. The goal is a
// stable API shape so a UI can be plugged in later.
//
// Entry policy (single source: @notive/permissions):
//   - non-member / cross-org / id-guess  -> NOT_FOUND
//   - authenticated, but not Admin role  -> FORBIDDEN(admin_only)
//
// Mutation routes (members.role/team/deactivate/reactivate, invitations
// create/cancel) intentionally delegate to the Step 5 services rather
// than duplicating logic. Last-Admin protection, manager_cannot_invite,
// cross-org NOT_FOUND, etc. all flow through the same code paths.
//
// Response shapes never contain:
//   - users.passwordHash
//   - users.emailVerificationTokenHash / emailVerificationExpiresAt
//   - users.passwordResetTokenHash / passwordResetExpiresAt
//   - sessions.tokenHash
//   - invitations.tokenHash
//
// Fields are explicitly listed (no `...spread`) so adding a new column
// to the schema cannot accidentally leak through admin endpoints.

import type { Membership, Organization, PrismaClient, RoleCode, UserStatus } from "@notive/db";
import { requireAdmin, requireMembership } from "@notive/permissions";

/**
 * Sections the future admin UI will render. Keeping this server-side
 * means a client can drive its navigation off the API instead of
 * hard-coding the list. Step 8 onward will append entries
 * (e.g. activity_log, settings, documents) without breaking clients.
 */
export interface AdminSection {
  /** Stable identifier used by routing / activity-log events. */
  key: string;
  /** Human label. UI may localize it; the key stays stable. */
  label: string;
  /** Path of the corresponding API root. */
  href: string;
}

const ADMIN_SECTIONS: ReadonlyArray<AdminSection> = [
  { key: "members", label: "Members", href: "/admin/members" },
  { key: "invitations", label: "Invitations", href: "/admin/invitations" },
];

export interface AdminHome {
  organization: { id: string; name: string; slug: string; status: string };
  membership: { id: string; role: RoleCode };
  sections: ReadonlyArray<AdminSection>;
}

export async function getAdminHome(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
): Promise<AdminHome> {
  const membership = await requireMembership(prisma, userId, organizationId);
  requireAdmin(membership);
  // requireMembership guarantees the org exists; load it for the
  // response payload.
  const org = (await prisma.organization.findUnique({
    where: { id: organizationId },
  })) as Organization;
  return {
    organization: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      status: org.status,
    },
    membership: { id: membership.id, role: membership.role },
    sections: ADMIN_SECTIONS,
  };
}

/** Member row exposed by the admin API. Sensitive fields are absent by construction. */
export interface AdminMember {
  membership: {
    id: string;
    role: RoleCode;
    status: string;
    teamId: string | null;
    joinedAt: Date;
  };
  user: {
    id: string;
    name: string;
    email: string;
    status: UserStatus;
    emailVerifiedAt: Date | null;
    lastLoginAt: Date | null;
  };
}

export async function listAdminMembers(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
): Promise<AdminMember[]> {
  const membership = await requireMembership(prisma, userId, organizationId);
  requireAdmin(membership);
  const rows = await prisma.membership.findMany({
    where: { organizationId, deletedAt: null },
    include: { user: true },
    orderBy: [{ status: "asc" }, { role: "desc" }, { createdAt: "asc" }],
  });
  return rows.map(toAdminMember);
}

function toAdminMember(
  row: Membership & { user: AdminMember["user"] & Record<string, unknown> },
): AdminMember {
  return {
    membership: {
      id: row.id,
      role: row.role,
      status: row.status,
      teamId: row.teamId,
      joinedAt: row.joinedAt,
    },
    user: {
      id: row.user.id,
      name: row.user.name,
      email: row.user.email,
      status: row.user.status,
      emailVerifiedAt: row.user.emailVerifiedAt,
      lastLoginAt: row.user.lastLoginAt,
    },
  };
}
