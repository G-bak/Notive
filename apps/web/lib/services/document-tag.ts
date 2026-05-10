// Document tag service (Phase C step 7).
//
// Org-level tag vocabulary + per-document tag set. Phase C plan §3.1
// (tag management is in scope) and §6.3 (tag filter on the document
// list).
//
// Permission policy:
//   - listTags: any active org member (requireMembership only).
//   - createTag: Editor or above (Viewer rejected with
//     FORBIDDEN(tag_create_not_allowed)). Same gate as
//     createDocument from Step 3 — creating shared org vocabulary
//     is a write that Viewer cannot perform.
//   - deleteTag: Manager or above. Tag delete is a destructive
//     org-level change (it removes the link from every document
//     that used it via DB CASCADE on document_tag_links). We keep
//     it Manager-tier so a single Editor cannot wipe everyone's
//     filters.
//   - setDocumentTags: requireDocumentEdit on the target document.
//     Tag assignment is per-document metadata, not vocabulary.
//
// Idempotency:
//   - createTag: same name in the same org returns the existing row
//     (DB unique on (organization_id, name)).
//   - setDocumentTags: PUT replace-all. Diff is recorded in audit
//     metadata { added, removed, total }.
//
// organization_id integrity:
//   - The DB composite FK
//     document_tag_links(tag_id, organization_id)
//       -> document_tags(id, organization_id)
//   makes a cross-org tag link physically impossible at the DB
//   layer. The service still validates each tagId exists in this
//   org before the write so a clean NOT_FOUND is returned instead
//   of a P2003.

import type { Document, DocumentTag, DocumentTagLink, PrismaClient } from "@notive/db";
import {
  type DocumentActor,
  type DocumentContext,
  type DocumentShareGrant,
  Errors,
  requireDocumentEdit,
  requireMembership,
  roleAtLeast,
} from "@notive/permissions";
import { z } from "zod";

import { Actions, recordActivity } from "../audit";

// ---------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------

const tagNameSchema = z.string().trim().min(1).max(64);

export const createTagInputSchema = z.object({
  name: tagNameSchema,
  color: z.string().trim().min(1).max(32).optional().nullable(),
});

export const setDocumentTagsInputSchema = z.object({
  tagIds: z.array(z.string().uuid()),
});

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

function isForeignKeyViolationError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  return (err as { code?: unknown }).code === "P2003";
}

// ---------------------------------------------------------------------
// Tag CRUD
// ---------------------------------------------------------------------

export async function listTags(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
): Promise<DocumentTag[]> {
  await requireMembership(prisma, userId, organizationId);
  return prisma.documentTag.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
  });
}

/**
 * Create a tag. Idempotent — if a tag with the same trimmed name
 * already exists in this org, the existing row is returned. The DB
 * unique on (organization_id, name) is the safety net for a
 * concurrent create race.
 */
export async function createTag(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  rawInput: unknown,
): Promise<DocumentTag> {
  const membership = await requireMembership(prisma, userId, organizationId);
  if (!roleAtLeast(membership.role, "Editor")) {
    throw Errors.forbidden("tag_create_not_allowed");
  }

  const parsed = createTagInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw Errors.invalid(parsed.error.issues[0]?.message ?? "invalid input");
  }

  const existing = await prisma.documentTag.findUnique({
    where: { organizationId_name: { organizationId, name: parsed.data.name } },
  });
  if (existing) return existing;

  try {
    return await prisma.documentTag.create({
      data: {
        organizationId,
        name: parsed.data.name,
        color: parsed.data.color ?? null,
        createdByUserId: userId,
      },
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      // Another writer raced us; fetch the row they created.
      const after = await prisma.documentTag.findUnique({
        where: { organizationId_name: { organizationId, name: parsed.data.name } },
      });
      if (after) return after;
    }
    throw err;
  }
}

export async function deleteTag(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  tagId: string,
): Promise<void> {
  const membership = await requireMembership(prisma, userId, organizationId);
  if (!roleAtLeast(membership.role, "Manager")) {
    throw Errors.forbidden("tag_delete_not_allowed");
  }
  const tag = await prisma.documentTag.findFirst({
    where: { id: tagId, organizationId },
  });
  if (!tag) {
    throw Errors.notFound();
  }
  // ON DELETE CASCADE on document_tag_links removes the per-document
  // links automatically (Step 1 migration).
  await prisma.documentTag.delete({ where: { id: tagId } });
}

// ---------------------------------------------------------------------
// setDocumentTags
// ---------------------------------------------------------------------

function shareKey(): never {
  throw new Error("unused");
}
void shareKey;

interface SetDocumentTagsResult {
  tags: DocumentTag[];
  added: number;
  removed: number;
  total: number;
}

/**
 * Replace the document's tag set. Edit permission required. Each
 * tagId is validated to exist in the same org before the write so
 * a cross-org tag id returns NOT_FOUND rather than a P2003 from
 * the composite FK.
 *
 * Returns the resulting tag rows ordered by name plus the diff
 * counts for the route handler.
 */
export async function setDocumentTags(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  documentId: string,
  rawInput: unknown,
): Promise<SetDocumentTagsResult> {
  const membership = await requireMembership(prisma, userId, organizationId);
  const actor = actorFromMembership(membership);

  const row = await loadActiveDocumentWithShares(prisma, organizationId, documentId);
  if (!row) {
    throw Errors.notFound();
  }
  const ctx = contextFromRow(row);
  requireDocumentEdit(actor, ctx, row.shares);

  const parsed = setDocumentTagsInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw Errors.invalid(parsed.error.issues[0]?.message ?? "invalid input");
  }

  // Duplicate detection on the input array. PUT replace-all takes
  // a set; same id twice is ambiguous.
  const desiredIds = parsed.data.tagIds;
  const desiredSet = new Set<string>();
  for (const id of desiredIds) {
    if (desiredSet.has(id)) {
      throw Errors.invalid(`duplicate tag id: ${id}`);
    }
    desiredSet.add(id);
  }

  // Bulk lookup: every requested tag must exist in this org. If any
  // is missing (cross-org or unknown id) we throw NOT_FOUND; the
  // existing-tag-list never echoes which one was bad.
  if (desiredIds.length > 0) {
    const found = await prisma.documentTag.findMany({
      where: { organizationId, id: { in: desiredIds } },
      select: { id: true },
    });
    if (found.length !== desiredIds.length) {
      throw Errors.notFound();
    }
  }

  // Diff against the current link set so audit metadata captures
  // add / remove counts.
  const existing = await prisma.documentTagLink.findMany({
    where: { documentId },
    select: { tagId: true },
  });
  const existingSet = new Set(existing.map((l) => l.tagId));

  let added = 0;
  let removed = 0;
  for (const id of desiredSet) {
    if (!existingSet.has(id)) added += 1;
  }
  for (const id of existingSet) {
    if (!desiredSet.has(id)) removed += 1;
  }

  // The existence check above is best-effort: a Manager could delete
  // one of the requested tags between the check and the createMany
  // below, which would surface as a Prisma P2003 (foreign key
  // violation) on the (tag_id, organization_id) composite FK. We
  // translate that race to NOT_FOUND — same response the existence
  // check would have produced — instead of leaking an INTERNAL_ERROR.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.documentTagLink.deleteMany({ where: { documentId } });
      if (desiredIds.length > 0) {
        await tx.documentTagLink.createMany({
          data: desiredIds.map((tagId) => ({
            documentId,
            tagId,
            organizationId,
          })),
        });
      }
    });
  } catch (err) {
    if (isForeignKeyViolationError(err)) {
      throw Errors.notFound();
    }
    throw err;
  }

  await recordActivity(prisma, {
    organizationId,
    actorUserId: userId,
    action: Actions.DOCUMENT_TAGS_UPDATED,
    targetType: "document",
    targetId: documentId,
    metadata: { added, removed, total: desiredIds.length },
  });

  // Return the resulting tag rows for the route to render.
  const links = (await prisma.documentTagLink.findMany({
    where: { documentId },
    include: { tag: true },
    orderBy: { tag: { name: "asc" } },
  })) as Array<DocumentTagLink & { tag: DocumentTag }>;

  return {
    tags: links.map((l) => l.tag),
    added,
    removed,
    total: desiredIds.length,
  };
}
