// Activity-log read service (Phase B step 8 — Admin only).
//
// Phase A §15 / Phase B locks reflected here:
//   - Admin only. Manager / Editor / Viewer get FORBIDDEN(admin_only).
//   - Cross-org / non-member / id-guess  -> NOT_FOUND.
//   - Response shape pins the audit contract: id, action, actorUserId,
//     targetType, targetId, result, metadata, createdAt. No raw row
//     spread, no FK objects, no PII beyond the actor user id.

import type { PrismaClient } from "@notive/db";
import { requireAdmin, requireMembership } from "@notive/permissions";

export interface ActivityLogEntry {
  id: string;
  action: string;
  actorUserId: string | null;
  targetType: string | null;
  targetId: string | null;
  result: string;
  metadata: unknown;
  createdAt: Date;
}

export interface ListActivityLogsOptions {
  /** Page size cap. Defaults to 100; values > 200 are clamped to 200. */
  limit?: number;
}

export async function listActivityLogs(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  opts: ListActivityLogsOptions = {},
): Promise<ActivityLogEntry[]> {
  const membership = await requireMembership(prisma, userId, organizationId);
  requireAdmin(membership);
  const limit = clampLimit(opts.limit);
  const rows = await prisma.activityLog.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    actorUserId: r.actorUserId,
    targetType: r.targetType,
    targetId: r.targetId,
    result: r.result,
    metadata: r.metadata,
    createdAt: r.createdAt,
  }));
}

function clampLimit(n: number | undefined): number {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
    return 100;
  }
  return Math.min(Math.floor(n), 200);
}
