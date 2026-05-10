// Document version service (Phase C step 5).
//
// Connects the document_versions table (Step 1) to the actual save /
// restore flow. Three concerns:
//
//   1. Snapshot creation. createDocumentVersionInTx is the only
//      place that writes to document_versions. It enforces
//      organization_id integrity (must equal the parent document's
//      organization_id) and resolves versionNumber via "max + 1
//      with bounded retry" so concurrent writes converge.
//
//   2. Read APIs. listDocumentVersions and getDocumentVersion
//      require View permission on the document — same rule as
//      reading the document body itself. Once Deleted the document
//      is NOT_FOUND for everyone, including the owner; version
//      rows are unreachable through these endpoints (Step 3
//      closure).
//
//   3. Restore. restoreDocumentVersion needs Edit permission. It
//      copies title/content from the chosen snapshot back onto the
//      live document, then writes a new version row whose snapshot
//      is the restored content. Existing version rows are NEVER
//      mutated — restore is recorded as a forward step. Phase C
//      plan §5.5 / §9.5 / §16.1.
//
// Status policy on restore (deliberate, conservative): the
// document's status is preserved. Restoring an Archived document
// does not flip it back to Active — only title/content move. If
// the user wants to bring the doc out of Archived they patch the
// status separately. This is documented in the Step 5 report.

import { type Document, type DocumentVersion, type PrismaClient, Prisma } from "@notive/db";
import {
  type DocumentActor,
  type DocumentContext,
  type DocumentShareGrant,
  Errors,
  requireDocumentEdit,
  requireDocumentView,
  requireMembership,
} from "@notive/permissions";

import { Actions, recordActivity } from "../audit";

type DbClient = PrismaClient | Prisma.TransactionClient;

// ---------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------

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
 * Load a document plus its share rows for permission evaluation.
 * Applies the Step 3 Deleted gate: rows with status=Deleted or
 * deletedAt set are returned as null so callers translate them to
 * NOT_FOUND for everyone.
 */
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

function isUniqueConstraintError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  return (err as { code?: unknown }).code === "P2002";
}

// ---------------------------------------------------------------------
// Snapshot creation helper (used by document.ts on create / update,
// and by restoreDocumentVersion below).
// ---------------------------------------------------------------------

interface CreateVersionInput {
  /** The document the new version belongs to. The helper reads `id`
   * and `organizationId` only; the title / content come from `opts`. */
  document: Pick<Document, "id" | "organizationId">;
  /** Title to capture in the snapshot. */
  title: string;
  /** Content to capture in the snapshot. */
  content: string;
  /** User who triggered the change. May be null only for system /
   * cron writers — not used today. */
  changedByUserId: string | null;
  changeSummary?: string | null;
}

/**
 * Insert one row into document_versions inside an existing
 * transaction. Caller passes a transaction client (or a plain
 * PrismaClient when no concurrent writer is expected).
 *
 * versionNumber is computed as `max(versionNumber) + 1` against the
 * current view of the table. The unique index
 * (document_id, version_number) catches a race between two
 * concurrent transactions on the same documentId; when that happens
 * Postgres marks the current transaction as aborted, so we cannot
 * retry inside the same transaction client — every subsequent
 * statement on it would fail with "current transaction is aborted".
 * Phase C therefore translates P2002 directly to
 * CONFLICT(version_conflict) and lets the route return a clean 409.
 *
 * If concurrency on a single document grows in later phases (e.g.
 * Phase D auto-save), the right escalation is one of:
 *   - retry the whole outer transaction
 *   - take a Postgres advisory lock keyed on documentId
 *   - move versionNumber onto a per-document Postgres SEQUENCE or
 *     a `documents.next_version_number` column updated under lock
 * None of those are needed yet — Phase C save flows are explicit
 * (no auto-save endpoint), so concurrent PATCH on the same doc is
 * rare and a 409 is acceptable user-facing behaviour.
 */
export async function createDocumentVersionInTx(
  client: DbClient,
  input: CreateVersionInput,
): Promise<DocumentVersion> {
  // Defense in depth: composite (document_id, organization_id) FK in
  // Step 1 already prevents the row from referring to a different
  // org's document, but we also require the caller to pass the
  // document with its organizationId so the helper writes a
  // consistent value rather than re-deriving it.
  const { document, title, content, changedByUserId, changeSummary } = input;

  const max = await client.documentVersion.aggregate({
    where: { documentId: document.id },
    _max: { versionNumber: true },
  });
  const next = (max._max.versionNumber ?? 0) + 1;
  try {
    return await client.documentVersion.create({
      data: {
        documentId: document.id,
        organizationId: document.organizationId,
        versionNumber: next,
        titleSnapshot: title,
        contentSnapshot: content,
        changedByUserId,
        changeSummary: changeSummary ?? null,
      },
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw Errors.conflict("version_conflict");
    }
    throw err;
  }
}

// ---------------------------------------------------------------------
// Read entry points
// ---------------------------------------------------------------------

/**
 * Versions for a document, newest first. Requires View permission on
 * the document — same gate as reading the document body. Deleted /
 * cross-org documents return NOT_FOUND.
 */
export async function listDocumentVersions(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  documentId: string,
): Promise<DocumentVersion[]> {
  const membership = await requireMembership(prisma, userId, organizationId);
  const actor = actorFromMembership(membership);

  const row = await loadActiveDocumentWithShares(prisma, organizationId, documentId);
  if (!row) {
    throw Errors.notFound();
  }
  const ctx = contextFromRow(row);
  requireDocumentView(actor, ctx, row.shares);

  return prisma.documentVersion.findMany({
    where: { documentId, organizationId },
    orderBy: { versionNumber: "desc" },
  });
}

/**
 * One version row for preview. Requires View on the document.
 * NOT_FOUND on cross-org / Deleted / unknown id, including when the
 * versionId belongs to a different document or organization.
 */
export async function getDocumentVersion(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  documentId: string,
  versionId: string,
): Promise<DocumentVersion> {
  const membership = await requireMembership(prisma, userId, organizationId);
  const actor = actorFromMembership(membership);

  const row = await loadActiveDocumentWithShares(prisma, organizationId, documentId);
  if (!row) {
    throw Errors.notFound();
  }
  const ctx = contextFromRow(row);
  requireDocumentView(actor, ctx, row.shares);

  const version = await prisma.documentVersion.findFirst({
    where: { id: versionId, documentId, organizationId },
  });
  if (!version) {
    throw Errors.notFound();
  }
  return version;
}

// ---------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------

interface RestoreResult {
  document: Document;
  /** The new version row created by the restore. The original
   * snapshot row is unchanged. */
  newVersion: DocumentVersion;
}

/**
 * Restore the document's title/content to the chosen version's
 * snapshot. Requires Edit permission. The restore itself becomes a
 * new version row whose changeSummary records which version it
 * came from; existing version rows are NEVER mutated.
 *
 * Status policy: the document's status (Draft / Active / Archived)
 * is intentionally preserved. Phase C plan §5.5 leaves status
 * transitions to a separate PATCH; conflating them with restore
 * would surprise a user who archived a document and then "restored
 * an old version" expecting the doc to stay archived.
 */
export async function restoreDocumentVersion(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  documentId: string,
  versionId: string,
): Promise<RestoreResult> {
  const membership = await requireMembership(prisma, userId, organizationId);
  const actor = actorFromMembership(membership);

  const row = await loadActiveDocumentWithShares(prisma, organizationId, documentId);
  if (!row) {
    throw Errors.notFound();
  }
  const ctx = contextFromRow(row);
  requireDocumentEdit(actor, ctx, row.shares);

  // Locate the source version. Anchored to (id, documentId,
  // organizationId) so a versionId that exists but belongs to
  // another document or org is still NOT_FOUND.
  const source = await prisma.documentVersion.findFirst({
    where: { id: versionId, documentId, organizationId },
  });
  if (!source) {
    throw Errors.notFound();
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.document.update({
      where: { id: documentId },
      data: {
        title: source.titleSnapshot,
        content: source.contentSnapshot,
      },
    });
    const newVersion = await createDocumentVersionInTx(tx, {
      document: { id: documentId, organizationId },
      title: source.titleSnapshot,
      content: source.contentSnapshot,
      changedByUserId: userId,
      changeSummary: `restored from version ${source.versionNumber}`,
    });
    return { document: updated, newVersion };
  });

  await recordActivity(prisma, {
    organizationId,
    actorUserId: userId,
    action: Actions.DOCUMENT_VERSION_RESTORED,
    targetType: "document",
    targetId: documentId,
    metadata: {
      restoredFromVersionId: source.id,
      restoredFromVersionNumber: source.versionNumber,
      newVersionNumber: result.newVersion.versionNumber,
    },
  });

  return result;
}
