// Document view-history service (Phase C step 6).
//
// Two concerns:
//
//   1. recordDocumentView: append-only writer called from
//      getDocument on success. Best-effort — a failure to insert
//      never bubbles up to the caller. Other read paths
//      (listDocuments, listDocumentShares, version preview) do
//      NOT log a view event; only opening the document detail
//      counts.
//
//   2. listRecentDocuments: return the user's recently-viewed
//      documents in this org, deduped by documentId (only the
//      most-recent view per document survives), filtered through
//      evaluateDocumentPermission so the user never sees a
//      document they cannot open today (e.g. a Private doc whose
//      share was revoked, or a doc that has since been Deleted).
//
// Audit: not recorded. View history is the audit-equivalent
// "user looked at this document" stream by itself; recording it
// twice (once here, once in activity_logs) would be noise and
// would inflate the audit row count by an order of magnitude.
// Phase G can revisit if the policy changes.

import type { Document, DocumentViewHistory, PrismaClient } from "@notive/db";
import {
  type DocumentActor,
  type DocumentContext,
  type DocumentShareGrant,
  evaluateDocumentPermission,
  requireMembership,
} from "@notive/permissions";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function clampLimit(input: number | null | undefined): number {
  if (input === null || input === undefined) return DEFAULT_LIMIT;
  if (!Number.isFinite(input)) return DEFAULT_LIMIT;
  const n = Math.floor(input);
  if (n < 1) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, n);
}

function actorFromMembership(membership: {
  userId: string;
  organizationId: string;
  role: DocumentActor["role"];
  teamId: string | null;
}): DocumentActor {
  return {
    userId: membership.userId,
    organizationId: membership.organizationId,
    role: membership.role,
    teamId: membership.teamId,
  };
}

function contextFromRow(doc: Document): DocumentContext {
  return {
    id: doc.id,
    organizationId: doc.organizationId,
    status: doc.status,
    authorUserId: doc.authorUserId,
    ownerUserId: doc.ownerUserId,
    ownerTeamId: doc.ownerTeamId,
    visibility: doc.visibility,
    deletedAt: doc.deletedAt,
  };
}

interface DocumentRowWithShares extends Document {
  shares: Array<{
    targetType: DocumentShareGrant["targetType"];
    targetId: string;
    permission: DocumentShareGrant["permission"];
  }>;
}

/**
 * Append a single view event for the user. Best-effort — caller
 * should not await for the side effect to succeed before
 * returning their primary response. The Step 1 schema enforces
 * organization_id integrity (composite FK) so a bad
 * (documentId, organizationId) combination is rejected at the
 * DB layer.
 *
 * Caller invariant: only invoke this when getDocument has
 * already succeeded, i.e. the (userId, documentId, organizationId)
 * triple has passed the View permission gate.
 */
export async function recordDocumentView(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  documentId: string,
): Promise<DocumentViewHistory | null> {
  try {
    return await prisma.documentViewHistory.create({
      data: {
        userId,
        organizationId,
        documentId,
        // viewedAt defaults to now() at the DB layer.
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[view-history] failed to append", { documentId, err });
    return null;
  }
}

interface RecentEntry {
  document: Document;
  viewedAt: Date;
}

/**
 * Recently-viewed documents for this user in this org, deduped by
 * documentId so each document appears at most once with its
 * latest viewedAt. Permission-filtered so the result contains
 * only documents the user can View today.
 *
 * Implementation:
 *   1. Group view-history rows by documentId, taking the max
 *      viewedAt. Order by max viewedAt DESC. Take a generous
 *      window (limit * 5, capped at 500) so the permission
 *      filter has enough candidates even after some are dropped.
 *   2. Fetch the document rows joined with shares for the
 *      candidate ids, excluding Deleted.
 *   3. Walk the grouped result in order, attaching each
 *      candidate document and applying the permission filter.
 *      Stop once `limit` distinct visible documents have been
 *      collected.
 */
export async function listRecentDocuments(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  opts: { limit?: number } = {},
): Promise<RecentEntry[]> {
  const membership = await requireMembership(prisma, userId, organizationId);
  const actor = actorFromMembership(membership);
  const limit = clampLimit(opts.limit);

  const fetchWindow = Math.min(limit * 5, 500);
  const grouped = await prisma.documentViewHistory.groupBy({
    by: ["documentId"],
    where: { userId, organizationId },
    _max: { viewedAt: true },
    orderBy: { _max: { viewedAt: "desc" } },
    take: fetchWindow,
  });

  if (grouped.length === 0) return [];
  const docIds = grouped.map((g) => g.documentId);

  const docs = (await prisma.document.findMany({
    where: {
      id: { in: docIds },
      organizationId,
      status: { not: "Deleted" },
      deletedAt: null,
    },
    include: {
      shares: {
        select: { targetType: true, targetId: true, permission: true },
      },
    },
  })) as DocumentRowWithShares[];

  const byId = new Map<string, DocumentRowWithShares>(docs.map((d) => [d.id, d]));

  const result: RecentEntry[] = [];
  for (const g of grouped) {
    const doc = byId.get(g.documentId);
    if (!doc) continue; // Deleted, or not in this org
    const ctx = contextFromRow(doc);
    const grant = evaluateDocumentPermission(actor, ctx, doc.shares);
    if (grant === null) continue;
    if (g._max.viewedAt === null) continue; // defensive — should not happen
    const { shares: _ignored, ...bare } = doc;
    void _ignored;
    result.push({ document: bare, viewedAt: g._max.viewedAt });
    if (result.length >= limit) break;
  }
  return result;
}
