// Document service (Phase C step 3).
//
// Glue between the Phase C step 1 schema (documents + supporting
// tables) and the Phase C step 2 permission helpers
// (@notive/permissions/documents). Exposes the five operations the
// Step 3 API routes need:
//
//   - createDocument
//   - listDocuments
//   - getDocument
//   - updateDocument
//   - deleteDocument (soft delete: status=Deleted, deletedAt=now)
//
// Phase A §15 / Phase C plan §8 / step 2 permission policy reflected
// here:
//
//   - Org boundary: every entry point starts with requireMembership,
//     which throws NOT_FOUND for cross-org access. The permission
//     helpers re-check organizationId, so the boundary is verified
//     twice on read paths.
//   - Viewer cannot create documents (Phase C plan §8.2). Service
//     rejects with FORBIDDEN(document_create_not_allowed).
//   - View / Edit / Manage decisions are routed through
//     requireDocumentView / Edit / Manage. Service code never builds
//     its own permission filter.
//   - Admin has no implicit body access (Phase A §15). The Admin role
//     is not special-cased anywhere in this file.
//   - Soft delete: DELETE sets status=Deleted and deletedAt=now.
//     Hard delete is never used. The DB has ON DELETE CASCADE on
//     children, but we deliberately do not exercise that path.
//     Once a document is in the Deleted state, every entry point
//     (get / list / update / delete) treats it as NOT_FOUND for
//     everyone — owner included — so the row's body and metadata
//     cannot leak through any code path.
//   - Audit: every successful mutation emits an `activity_logs` row
//     via the Phase B writer. Failures of the writer do not break
//     the user-facing operation (best-effort, Phase B step 8).
//   - Out of scope for Step 3: share rows, version restore, favorite,
//     view history. The create/update payload schemas reject these
//     fields so they cannot leak in by mistake.

import type {
  Document,
  DocumentSourceType,
  DocumentStatus,
  DocumentVisibility,
  PrismaClient,
} from "@notive/db";
import {
  type DocumentActor,
  type DocumentContext,
  type DocumentShareGrant,
  Errors,
  evaluateDocumentPermission,
  requireDocumentEdit,
  requireDocumentManage,
  requireDocumentView,
  requireMembership,
  roleAtLeast,
} from "@notive/permissions";
import { z } from "zod";

import { Actions, recordActivity } from "../audit";

// ---------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------

const titleSchema = z.string().trim().min(1).max(300);
const contentSchema = z.string().max(1_000_000); // 1MB cap on body for Step 3
const documentTypeSchema = z.string().trim().min(1).max(64);
const visibilitySchema = z.enum(["Private", "Team", "Organization", "SpecificUsers"]);
const statusUpdateSchema = z.enum(["Draft", "Active", "Archived"]); // delete uses DELETE route, not PATCH

export const createDocumentInputSchema = z.object({
  title: titleSchema,
  content: contentSchema.optional(),
  documentType: documentTypeSchema,
  visibility: visibilitySchema.optional(),
  ownerTeamId: z.string().uuid().nullable().optional(),
});

interface UpdateDocumentShape {
  title?: string;
  content?: string;
  documentType?: string;
  visibility?: DocumentVisibility;
  ownerTeamId?: string | null;
  status?: "Draft" | "Active" | "Archived";
}

export const updateDocumentInputSchema = z
  .object({
    title: titleSchema.optional(),
    content: contentSchema.optional(),
    documentType: documentTypeSchema.optional(),
    visibility: visibilitySchema.optional(),
    ownerTeamId: z.string().uuid().nullable().optional(),
    status: statusUpdateSchema.optional(),
  })
  .refine(
    (d: UpdateDocumentShape) =>
      d.title !== undefined ||
      d.content !== undefined ||
      d.documentType !== undefined ||
      d.visibility !== undefined ||
      d.ownerTeamId !== undefined ||
      d.status !== undefined,
    "no fields to update",
  );

// ---------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------

/**
 * Build a {@link DocumentActor} from a membership row. The actor is
 * the input shape the @notive/permissions document helpers expect.
 */
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

/**
 * Project a `documents` row to the {@link DocumentContext} shape the
 * permission helpers need. Does not touch `content` — the projection
 * is pure metadata.
 */
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
 * Validate that `ownerTeamId` (when set) belongs to the same org.
 * Phase C step 1 schema already has a composite FK (owner_team_id,
 * organization_id) → teams(id, organization_id), so a write with a
 * cross-org team would be rejected at the DB layer. Doing the check
 * in the service first lets us return a clean NOT_FOUND instead of
 * a P2003 from Prisma.
 */
async function assertTeamInOrg(
  prisma: PrismaClient,
  teamId: string,
  organizationId: string,
): Promise<void> {
  const t = await prisma.team.findFirst({
    where: { id: teamId, organizationId, deletedAt: null },
  });
  if (!t) {
    throw Errors.notFound();
  }
}

// ---------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------

export async function createDocument(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  rawInput: unknown,
): Promise<Document> {
  const membership = await requireMembership(prisma, userId, organizationId);
  // Phase C plan §8.2: Viewer cannot create documents. Editor / Manager /
  // Admin all may. Use roleAtLeast so a future role refactor stays
  // consistent.
  if (!roleAtLeast(membership.role, "Editor")) {
    throw Errors.forbidden("document_create_not_allowed");
  }

  const parsed = createDocumentInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw Errors.invalid(parsed.error.issues[0]?.message ?? "invalid input");
  }

  // ownerTeamId resolution:
  //   - explicitly null  -> store null
  //   - explicitly set   -> validate it is in this org, then store
  //   - omitted          -> default to the actor's primary team id
  //                         (which itself may be null)
  let ownerTeamId: string | null;
  if (parsed.data.ownerTeamId === undefined) {
    ownerTeamId = membership.teamId;
  } else if (parsed.data.ownerTeamId === null) {
    ownerTeamId = null;
  } else {
    await assertTeamInOrg(prisma, parsed.data.ownerTeamId, organizationId);
    ownerTeamId = parsed.data.ownerTeamId;
  }

  const visibility: DocumentVisibility = parsed.data.visibility ?? "Private";
  const sourceType: DocumentSourceType = "Manual";

  const created = await prisma.document.create({
    data: {
      organizationId,
      title: parsed.data.title,
      content: parsed.data.content ?? "",
      documentType: parsed.data.documentType,
      status: "Draft",
      ownerUserId: userId,
      authorUserId: userId,
      ownerTeamId,
      visibility,
      sourceType,
    },
  });

  await recordActivity(prisma, {
    organizationId,
    actorUserId: userId,
    action: Actions.DOCUMENT_CREATED,
    targetType: "document",
    targetId: created.id,
    metadata: {
      title: created.title,
      documentType: created.documentType,
      visibility: created.visibility,
    },
  });

  return created;
}

/**
 * Return the documents the actor can View, ordered by most-recently-
 * updated first. Permission filtering happens in application code via
 * {@link evaluateDocumentPermission} so the rule stays in one place;
 * a future Phase F search index will reuse the same helper.
 *
 * Deleted documents are excluded at the SQL layer — no actor (not even
 * Manage holders) sees them in the standard list. Archived documents
 * are returned and the caller can filter by `status` client-side.
 */
export async function listDocuments(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
): Promise<Document[]> {
  const membership = await requireMembership(prisma, userId, organizationId);
  const actor = actorFromMembership(membership);

  const rows = (await prisma.document.findMany({
    where: { organizationId, status: { not: "Deleted" }, deletedAt: null },
    include: {
      shares: {
        select: { targetType: true, targetId: true, permission: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  })) as DocumentRowWithShares[];

  const visible: Document[] = [];
  for (const row of rows) {
    const ctx = contextFromRow(row);
    const grant = evaluateDocumentPermission(actor, ctx, row.shares);
    if (grant !== null) {
      // strip the joined shares before returning so the public surface
      // matches the bare `Document` type
      const { shares: _ignored, ...doc } = row;
      void _ignored;
      visible.push(doc);
    }
  }
  return visible;
}

/**
 * Return the document and the actor's permission level on it. Throws
 * NOT_FOUND when the actor cannot view the document — either because
 * the document does not exist, lives in another org, or the actor has
 * no access path. Existence is never leaked.
 */
export async function getDocument(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  documentId: string,
): Promise<{ document: Document; permission: "View" | "Edit" | "Manage" }> {
  const membership = await requireMembership(prisma, userId, organizationId);
  const actor = actorFromMembership(membership);

  const row = (await prisma.document.findFirst({
    where: { id: documentId, organizationId },
    include: {
      shares: {
        select: { targetType: true, targetId: true, permission: true },
      },
    },
  })) as DocumentRowWithShares | null;
  if (!row) {
    throw Errors.notFound();
  }

  const ctx = contextFromRow(row);
  const permission = requireDocumentView(actor, ctx, row.shares);

  const { shares: _ignored, ...doc } = row;
  void _ignored;
  return { document: doc, permission };
}

export async function updateDocument(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  documentId: string,
  rawInput: unknown,
): Promise<Document> {
  const membership = await requireMembership(prisma, userId, organizationId);
  const actor = actorFromMembership(membership);

  const row = (await prisma.document.findFirst({
    where: { id: documentId, organizationId },
    include: {
      shares: {
        select: { targetType: true, targetId: true, permission: true },
      },
    },
  })) as DocumentRowWithShares | null;
  if (!row) {
    throw Errors.notFound();
  }

  const parsed = updateDocumentInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw Errors.invalid(parsed.error.issues[0]?.message ?? "invalid input");
  }

  // Permission requirement depends on which fields are being changed.
  // Body / title / content / documentType / status need Edit. Changing
  // visibility or owner team is a sharing-shape change which we treat
  // as Manage — Phase C plan §8.2 lists "share" alongside Manager-tier
  // operations. status=Archived is also Manage (it is a destructive-
  // ish state transition; the standard Edit path should not let an
  // Editor archive someone else's document).
  const ctx = contextFromRow(row);
  const wantsManage =
    parsed.data.visibility !== undefined ||
    parsed.data.ownerTeamId !== undefined ||
    parsed.data.status === "Archived";
  if (wantsManage) {
    requireDocumentManage(actor, ctx, row.shares);
  } else {
    requireDocumentEdit(actor, ctx, row.shares);
  }

  if (parsed.data.ownerTeamId !== undefined && parsed.data.ownerTeamId !== null) {
    await assertTeamInOrg(prisma, parsed.data.ownerTeamId, organizationId);
  }

  const data: {
    title?: string;
    content?: string;
    documentType?: string;
    visibility?: DocumentVisibility;
    ownerTeamId?: string | null;
    status?: DocumentStatus;
  } = {};
  const changed: string[] = [];
  if (parsed.data.title !== undefined) {
    data.title = parsed.data.title;
    changed.push("title");
  }
  if (parsed.data.content !== undefined) {
    data.content = parsed.data.content;
    changed.push("content");
  }
  if (parsed.data.documentType !== undefined) {
    data.documentType = parsed.data.documentType;
    changed.push("documentType");
  }
  if (parsed.data.visibility !== undefined) {
    data.visibility = parsed.data.visibility;
    changed.push("visibility");
  }
  if (parsed.data.ownerTeamId !== undefined) {
    data.ownerTeamId = parsed.data.ownerTeamId;
    changed.push("ownerTeamId");
  }
  if (parsed.data.status !== undefined) {
    data.status = parsed.data.status;
    changed.push("status");
  }

  const updated = await prisma.document.update({
    where: { id: documentId },
    data,
  });

  await recordActivity(prisma, {
    organizationId,
    actorUserId: userId,
    action: Actions.DOCUMENT_UPDATED,
    targetType: "document",
    targetId: updated.id,
    metadata: { changed },
  });

  return updated;
}

/**
 * Soft-delete: status=Deleted, deletedAt=now. The row stays in the
 * table so future steps can support restore. Manage permission is
 * required (owner / Manager of the owner team on a Team-visible
 * document / explicit Manage share / Editor cannot delete other
 * peoples' docs even when shared with Edit).
 */
export async function deleteDocument(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  documentId: string,
): Promise<Document> {
  const membership = await requireMembership(prisma, userId, organizationId);
  const actor = actorFromMembership(membership);

  const row = (await prisma.document.findFirst({
    where: { id: documentId, organizationId },
    include: {
      shares: {
        select: { targetType: true, targetId: true, permission: true },
      },
    },
  })) as DocumentRowWithShares | null;
  if (!row) {
    throw Errors.notFound();
  }

  // Already-Deleted rows are NOT_FOUND for everyone. Returning the row
  // would (a) leak its body / metadata to anyone who guesses the id and
  // (b) contradict the "Deleted document is NOT_FOUND" rule that
  // getDocument and listDocuments enforce. Permission re-checks below
  // would also reject — evaluateDocumentPermission gates on status —
  // but we make the rejection explicit and skip the permission helper
  // entirely so the response is uniform regardless of caller.
  if (row.status === "Deleted" || row.deletedAt !== null) {
    throw Errors.notFound();
  }

  const ctx = contextFromRow(row);
  requireDocumentManage(actor, ctx, row.shares);

  const updated = await prisma.document.update({
    where: { id: documentId },
    data: { status: "Deleted", deletedAt: new Date() },
  });

  await recordActivity(prisma, {
    organizationId,
    actorUserId: userId,
    action: Actions.DOCUMENT_DELETED,
    targetType: "document",
    targetId: updated.id,
    metadata: { title: updated.title },
  });

  return updated;
}
