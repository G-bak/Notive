// Document favorite service (Phase C step 6).
//
// Adds GET / PUT / DELETE for the per-user favorite mark on a
// document. Phase C plan §6.2 (P1 favorites screen) and §3.1
// (favorite filter on the document list).
//
// Permission policy:
//   - Every entry point starts with requireMembership (cross-org
//     -> NOT_FOUND).
//   - PUT and DELETE both need View on the document. DELETE
//     idempotency does NOT bypass the View gate — a stranger who
//     guesses an id should not be able to detect existence by
//     calling DELETE and seeing a 200 vs NOT_FOUND. The Step 3
//     existence-leak rule applies here too.
//   - Deleted documents are NOT_FOUND for everyone (Step 3
//     closure). Favorite ops on a deleted doc all fail NOT_FOUND.
//   - listFavorites filters the result through
//     evaluateDocumentPermission so a user who lost view access
//     after favoriting (e.g. document went Private without an
//     explicit share) silently drops out of the list — same
//     pattern as listDocuments in Step 3.
//
// Idempotency:
//   - PUT creates the row if it does not exist; otherwise returns
//     the existing row. The DB unique on (userId, documentId)
//     guarantees only one row.
//   - DELETE removes the row if present; otherwise no-op.
//
// Audit: not recorded in Phase C. Favorite is a personal annotation
// on the user's view of a document — it does not affect document
// content or permission, and the volume could be high (every
// session toggling repeatedly). Phase G can revisit if compliance
// requires per-user favorite trails. The intent is documented in
// the Step 6 report.

import type { Document, DocumentFavorite, PrismaClient } from "@notive/db";
import {
  type DocumentActor,
  type DocumentContext,
  type DocumentShareGrant,
  Errors,
  evaluateDocumentPermission,
  requireDocumentView,
  requireMembership,
} from "@notive/permissions";

// ---------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------

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

async function loadActiveDocumentWithShares(
  prisma: PrismaClient,
  organizationId: string,
  documentId: string,
): Promise<DocumentRowWithShares | null> {
  const row = (await prisma.document.findFirst({
    where: { id: documentId, organizationId },
    include: {
      shares: {
        select: { targetType: true, targetId: true, permission: true },
      },
    },
  })) as DocumentRowWithShares | null;
  if (!row) return null;
  if (row.status === "Deleted" || row.deletedAt !== null) return null;
  return row;
}

// ---------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------

/**
 * Mark the document as a favorite for this user. Idempotent —
 * calling on an already-favorited document returns the existing
 * row. View permission is required so a stranger cannot use this
 * endpoint to confirm a document's existence by id.
 */
export async function setFavorite(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  documentId: string,
): Promise<DocumentFavorite> {
  const membership = await requireMembership(prisma, userId, organizationId);
  const actor = actorFromMembership(membership);

  const row = await loadActiveDocumentWithShares(prisma, organizationId, documentId);
  if (!row) {
    throw Errors.notFound();
  }
  const ctx = contextFromRow(row);
  requireDocumentView(actor, ctx, row.shares);

  const existing = await prisma.documentFavorite.findUnique({
    where: { userId_documentId: { userId, documentId } },
  });
  if (existing) {
    return existing;
  }
  return prisma.documentFavorite.create({
    data: { userId, organizationId, documentId },
  });
}

/**
 * Remove the favorite mark. Idempotent — succeeds silently if the
 * row does not exist. View permission is still required: even
 * though delete does not reveal new information, allowing it
 * without a permission check would create a "200 vs NOT_FOUND"
 * existence oracle.
 */
export async function unsetFavorite(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  documentId: string,
): Promise<void> {
  const membership = await requireMembership(prisma, userId, organizationId);
  const actor = actorFromMembership(membership);

  const row = await loadActiveDocumentWithShares(prisma, organizationId, documentId);
  if (!row) {
    throw Errors.notFound();
  }
  const ctx = contextFromRow(row);
  requireDocumentView(actor, ctx, row.shares);

  await prisma.documentFavorite.deleteMany({
    where: { userId, documentId },
  });
}

interface FavoriteEntry {
  document: Document;
  favoritedAt: Date;
}

/**
 * Return the user's favorite documents in this org, newest favorite
 * first. Hidden documents (cross-org / deleted / lost-view) are
 * filtered out via evaluateDocumentPermission so the returned set
 * is exactly what the user could open today.
 *
 * Limit is bounded; see clampLimit. The favorite table is per-user
 * so a user with many thousands of favorites would still scan
 * everything in memory; that is acceptable for Phase C and is
 * documented as a follow-up in the Step 6 report.
 */
export async function listFavorites(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  opts: { limit?: number } = {},
): Promise<FavoriteEntry[]> {
  const membership = await requireMembership(prisma, userId, organizationId);
  const actor = actorFromMembership(membership);
  const limit = clampLimit(opts.limit);

  const favs = await prisma.documentFavorite.findMany({
    where: { userId, organizationId },
    include: {
      document: {
        include: {
          shares: {
            select: { targetType: true, targetId: true, permission: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const result: FavoriteEntry[] = [];
  for (const f of favs) {
    const doc = f.document as DocumentRowWithShares;
    if (doc.status === "Deleted" || doc.deletedAt !== null) continue;
    const ctx = contextFromRow(doc);
    const grant = evaluateDocumentPermission(actor, ctx, doc.shares);
    if (grant === null) continue;
    const { shares: _ignored, ...bare } = doc;
    void _ignored;
    result.push({ document: bare, favoritedAt: f.createdAt });
    if (result.length >= limit) break;
  }
  return result;
}
