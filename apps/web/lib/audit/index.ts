// Audit / activity-log writer (Phase B step 8 — skeleton level).
//
// Phase B locks reflected here:
//   - Events live in the existing `activity_logs` table (Step 3 schema,
//     unchanged). No new table, no migration in this step.
//   - Writes are best-effort: a failure to record must NEVER bubble up
//     and break the user-facing operation. We swallow errors and log to
//     stderr. This is acceptable at skeleton level; Phase G hardening
//     can introduce a queue / retry / SLO if needed.
//   - `organizationId` is NOT NULL in the schema, so events that have
//     no organization context (login before any membership is set up,
//     password reset for an unaffiliated user) are simply not recorded.
//     The helper `findActiveOrganizationForUser` returns null in that
//     case so call sites can decide.
//   - Action codes are stable strings in `category.verb` form. They are
//     the contract surface for any future analytics / audit reader.
//     Adding a new value is a contract change — extend `Actions`.

import { Prisma, type ActivityLog, type PrismaClient } from "@notive/db";

/**
 * Stable, dotted action identifiers. Phase B records exactly these 15.
 * Step 9+ may extend the set; do NOT rename existing values.
 */
export const Actions = {
  AUTH_LOGIN: "auth.login",
  AUTH_LOGOUT: "auth.logout",
  AUTH_PASSWORD_RESET_COMPLETED: "auth.password_reset.completed",

  ORGANIZATION_CREATED: "organization.created",
  ORGANIZATION_UPDATED: "organization.updated",

  TEAM_CREATED: "team.created",
  TEAM_UPDATED: "team.updated",
  TEAM_ARCHIVED: "team.archived",

  MEMBERSHIP_ROLE_CHANGED: "membership.role_changed",
  MEMBERSHIP_TEAM_CHANGED: "membership.team_changed",
  MEMBERSHIP_DEACTIVATED: "membership.deactivated",
  MEMBERSHIP_REACTIVATED: "membership.reactivated",

  INVITATION_CREATED: "invitation.created",
  INVITATION_CANCELLED: "invitation.cancelled",
  INVITATION_ACCEPTED: "invitation.accepted",

  // Phase C step 3 — document mutations.
  DOCUMENT_CREATED: "document.created",
  DOCUMENT_UPDATED: "document.updated",
  DOCUMENT_DELETED: "document.deleted",

  // Phase C step 4 — document sharing API.
  DOCUMENT_SHARES_UPDATED: "document.shares_updated",
} as const;

export type AuditAction = (typeof Actions)[keyof typeof Actions];

export type AuditTargetType =
  | "user"
  | "organization"
  | "team"
  | "membership"
  | "invitation"
  | "document";

export interface AuditEvent {
  organizationId: string;
  actorUserId: string | null;
  action: AuditAction;
  targetType?: AuditTargetType | null;
  targetId?: string | null;
  result?: "Success" | "Failed";
  metadata?: Prisma.InputJsonValue | null;
}

type AuditClient = Pick<PrismaClient, "activityLog">;

/**
 * Best-effort write. Never throws. Callers can `await` without a
 * try/catch because the function swallows any DB error and logs it
 * to stderr. Returning the row (or null) lets tests assert directly.
 */
export async function recordActivity(
  prisma: AuditClient,
  event: AuditEvent,
): Promise<ActivityLog | null> {
  try {
    return await prisma.activityLog.create({
      data: {
        organizationId: event.organizationId,
        actorUserId: event.actorUserId,
        action: event.action,
        targetType: event.targetType ?? null,
        targetId: event.targetId ?? null,
        result: event.result ?? "Success",
        metadata: event.metadata ?? Prisma.JsonNull,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[audit] failed to record event", { action: event.action, err });
    return null;
  }
}

/**
 * Resolve the user's current active organization for audit attribution.
 *
 * Phase A §15: a user has at most one active membership. We look that
 * up so login / logout / password-reset can be recorded under the org
 * they belong to. Returns null when the user has no active membership
 * yet (just signed up, not yet accepted an invite, etc.) — call sites
 * skip recording in that case.
 */
export async function findActiveOrganizationForUser(
  prisma: Pick<PrismaClient, "membership">,
  userId: string,
): Promise<string | null> {
  const m = await prisma.membership.findFirst({
    where: { userId, status: "Active", deletedAt: null },
    select: { organizationId: true },
  });
  return m?.organizationId ?? null;
}
