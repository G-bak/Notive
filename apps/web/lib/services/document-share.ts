// Document share service (Phase C step 4).
//
// Reads and replaces the share rows for a single document. All
// permission decisions go through the Phase C step 2 helpers; this
// file does not introduce any new permission rule.
//
// Key policies:
//
//   - Manage permission is required to read OR replace shares. Even
//     a read-only viewer of the share list could leak who else has
//     access to a Private document, so we keep symmetry with write.
//   - Once a document is in Deleted state, every entry point treats
//     it as NOT_FOUND for everyone — owner included. Same rule the
//     Step 3 service code applies (Codex closure on the Step 3
//     idempotent-delete leak).
//   - PUT is replace-all. The request body is the *new complete set*
//     of shares for the document. Any existing share not present is
//     removed, new ones are inserted, and changed permissions are
//     updated.
//   - target validation: targetType is one of User / Team /
//     Organization (no Department — Phase A §15). Each target is
//     verified to exist in the same organization as the document.
//     Polymorphic target_id is otherwise unconstrained at the DB
//     layer (Step 1 left this to the service), so this validation is
//     load-bearing for cross-org leak prevention.
//   - Duplicate (targetType, targetId) entries in the request are
//     rejected as INVALID_INPUT before any DB write.
//   - Owner may appear as a User-target share. Permission
//     evaluation already gives the owner Manage from ownership, so
//     this is redundant; we still allow it because there is no
//     security risk and disallowing it would surprise users.

import type {
  Document,
  DocumentShare,
  DocumentSharePermission,
  DocumentShareTargetType,
  PrismaClient,
} from "@notive/db";
import {
  type DocumentActor,
  type DocumentContext,
  Errors,
  requireDocumentManage,
  requireMembership,
} from "@notive/permissions";
import { z } from "zod";

import { Actions, recordActivity } from "../audit";

// ---------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------

const shareEntrySchema = z.object({
  targetType: z.enum(["User", "Team", "Organization"]),
  targetId: z.string().uuid(),
  permission: z.enum(["View", "Edit", "Manage"]),
});

export const replaceSharesInputSchema = z.object({
  shares: z.array(shareEntrySchema),
});

export type ShareEntryInput = z.infer<typeof shareEntrySchema>;

// ---------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------

interface DocumentRowWithShares extends Document {
  shares: DocumentShare[];
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

function shareKey(targetType: DocumentShareTargetType, targetId: string): string {
  return `${targetType}:${targetId}`;
}

/**
 * Fetch the document plus its current shares, applying the same
 * Deleted gate the Step 3 service uses everywhere. Returns null only
 * when the document does not exist for this org; the caller should
 * convert null into NOT_FOUND. Deleted rows also return null so the
 * caller never sees them.
 */
async function loadDocumentForManage(
  prisma: PrismaClient,
  organizationId: string,
  documentId: string,
): Promise<DocumentRowWithShares | null> {
  const row = (await prisma.document.findFirst({
    where: { id: documentId, organizationId },
    include: { shares: true },
  })) as DocumentRowWithShares | null;
  if (!row) return null;
  if (row.status === "Deleted" || row.deletedAt !== null) return null;
  return row;
}

/**
 * Validate that every share entry's target exists and belongs to the
 * same organization as the document. Throws INVALID_INPUT for shape /
 * duplicate problems and NOT_FOUND for missing targets — NOT_FOUND
 * keeps the response shape consistent with cross-org existence
 * leakage rules (Phase A §15).
 */
async function validateShareTargets(
  prisma: PrismaClient,
  organizationId: string,
  entries: readonly ShareEntryInput[],
): Promise<void> {
  // Duplicate detection by (targetType, targetId). Different
  // permissions on the same target are still a duplicate — the
  // request is ambiguous, reject before the DB write.
  const seen = new Set<string>();
  for (const e of entries) {
    const k = shareKey(e.targetType, e.targetId);
    if (seen.has(k)) {
      throw Errors.invalid(`duplicate share target: ${k}`);
    }
    seen.add(k);
  }

  // Bulk lookups so a large share list does not turn into N round-trips.
  const userIds = entries.filter((e) => e.targetType === "User").map((e) => e.targetId);
  const teamIds = entries.filter((e) => e.targetType === "Team").map((e) => e.targetId);
  const orgEntries = entries.filter((e) => e.targetType === "Organization");

  // Organization targets must equal the document's organization.
  // Sharing "to organization X" where X is different is a cross-org
  // leak attempt — reject as NOT_FOUND, do not echo the id.
  for (const e of orgEntries) {
    if (e.targetId !== organizationId) {
      throw Errors.notFound();
    }
  }

  if (userIds.length > 0) {
    // A user is a valid share target only if they have an Active
    // membership in this org. Using membership rather than a bare
    // user lookup blocks "share to a user who exists but is not in
    // this org" cleanly. Disabled / Removed members are also
    // excluded — restoring a removed member implicitly restores any
    // share targeting them is the wrong semantics.
    const memberships = await prisma.membership.findMany({
      where: {
        organizationId,
        status: "Active",
        deletedAt: null,
        userId: { in: userIds },
      },
      select: { userId: true },
    });
    const found = new Set(memberships.map((m) => m.userId));
    for (const id of userIds) {
      if (!found.has(id)) {
        throw Errors.notFound();
      }
    }
  }

  if (teamIds.length > 0) {
    const teams = await prisma.team.findMany({
      where: { organizationId, deletedAt: null, id: { in: teamIds } },
      select: { id: true },
    });
    const found = new Set(teams.map((t) => t.id));
    for (const id of teamIds) {
      if (!found.has(id)) {
        throw Errors.notFound();
      }
    }
  }
}

// ---------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------

/**
 * Return the shares for a document. Manage permission required —
 * even a read of the share list reveals who else has access, so we
 * keep symmetry with the write path.
 */
export async function listDocumentShares(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  documentId: string,
): Promise<DocumentShare[]> {
  const membership = await requireMembership(prisma, userId, organizationId);
  const actor = actorFromMembership(membership);

  const row = await loadDocumentForManage(prisma, organizationId, documentId);
  if (!row) {
    throw Errors.notFound();
  }
  const ctx = contextFromRow(row);
  requireDocumentManage(actor, ctx, row.shares);

  return row.shares;
}

/**
 * Replace the document's share rows with the provided set.
 *
 * Replace-all semantics: the request is the new complete share state.
 * We compute a diff against the existing rows for audit metadata, then
 * run a transaction that deletes everything and inserts the new set.
 *
 * Returns the resulting share rows so the route handler can render
 * them without a re-fetch.
 */
export async function replaceDocumentShares(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  documentId: string,
  rawInput: unknown,
): Promise<DocumentShare[]> {
  const membership = await requireMembership(prisma, userId, organizationId);
  const actor = actorFromMembership(membership);

  const row = await loadDocumentForManage(prisma, organizationId, documentId);
  if (!row) {
    throw Errors.notFound();
  }
  const ctx = contextFromRow(row);
  requireDocumentManage(actor, ctx, row.shares);

  const parsed = replaceSharesInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw Errors.invalid(parsed.error.issues[0]?.message ?? "invalid input");
  }

  await validateShareTargets(prisma, organizationId, parsed.data.shares);

  // Build maps for diff. Existing rows keyed by (targetType, targetId);
  // desired entries keyed the same way.
  const existing = new Map<string, DocumentShare>();
  for (const s of row.shares) {
    existing.set(shareKey(s.targetType, s.targetId), s);
  }
  const desired = new Map<string, ShareEntryInput>();
  for (const e of parsed.data.shares) {
    desired.set(shareKey(e.targetType, e.targetId), e);
  }

  let added = 0;
  let updated = 0;
  let removed = 0;
  for (const [k, e] of desired) {
    const old = existing.get(k);
    if (!old) {
      added += 1;
    } else if (old.permission !== e.permission) {
      updated += 1;
    }
  }
  for (const k of existing.keys()) {
    if (!desired.has(k)) {
      removed += 1;
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.documentShare.deleteMany({ where: { documentId } });
    if (parsed.data.shares.length > 0) {
      await tx.documentShare.createMany({
        data: parsed.data.shares.map((e) => ({
          documentId,
          organizationId,
          targetType: e.targetType as DocumentShareTargetType,
          targetId: e.targetId,
          permission: e.permission as DocumentSharePermission,
          createdByUserId: userId,
        })),
      });
    }
    return tx.documentShare.findMany({
      where: { documentId },
      orderBy: [{ targetType: "asc" }, { targetId: "asc" }],
    });
  });

  await recordActivity(prisma, {
    organizationId,
    actorUserId: userId,
    action: Actions.DOCUMENT_SHARES_UPDATED,
    targetType: "document",
    targetId: documentId,
    metadata: {
      added,
      updated,
      removed,
      total: parsed.data.shares.length,
    },
  });

  return result;
}
