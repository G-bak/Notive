// AI preview save-to-document service (Phase D step 5).
//
// This is the FIRST point in the AI flow where preview body crosses
// into permanent storage. Up to here:
//
//   - Step 1 (`ai-request.ts`)      - metadata only, no body fields.
//   - Step 2 (`ai-generation.ts`)   - preview body in memory only.
//   - Step 3 (`ai-preview.ts` /
//     `ai/preview/store.ts`)        - preview body in short-term store
//                                     (in-memory / future Redis), 24h
//                                     idle TTL, requester-only key.
//   - Step 4 (route smoke)          - exposes Steps 2/3 over HTTP.
//
// Save is an explicit user action. It is the only path that copies
// `{ title, content }` from the preview into a `documents` row. CLAUDE.md
// CLAUDE.md section 4.4 ("AI output is a draft until the user reviews
// and saves it") and Phase A section 15 (body retention) are the
// load-bearing constraints.
//
// Atomicity:
//   - All four mutations happen inside a single Prisma transaction:
//       1. `documents` row created (sourceType = AI, aiRequestId set).
//       2. `document_versions` initial row #1.
//       3. `ai_results` row updated: status -> Saved, savedDocumentId set.
//       4. `ai_requests` row updated: resultSaved -> true.
//   - Double-save races are blocked by a `resultSaved: false` precondition
//     on the ai_request update (updateMany returns count=0 on the second
//     attempt -> throw CONFLICT -> transaction rolls back -> no half-linked
//     document is left behind).
//   - The preview store is touched OUTSIDE the transaction (in-memory /
//     external system). Load happens before the tx; discard happens after
//     a successful commit. A discard failure is non-fatal; the entry
//     ages out via TTL.
//
// Permission policy:
//   - requireMembership: cross-org actor -> NOT_FOUND (existence-leak guard).
//   - Current membership must still be Editor or above because save creates
//     a document.
//   - Requester-only: aiRequest.requestedByUserId must equal session
//     user. Peer / wrong-user / missing -> NOT_FOUND.
//   - aiRequest.status must be Completed. Other terminal statuses
//     (Failed / Cancelled) and non-terminal (Pending / Processing) all
//     map to CONFLICT(ai_request_not_saveable).
//   - aiRequest.resultSaved === true -> CONFLICT(ai_request_already_saved).
//   - The preview key includes (org, user, aiRequest), so even after
//     passing the requester check above, a missing preview entry maps
//     to NOT_FOUND (expired or already discarded).

import type { AiRequest, AiResult, Document, PrismaClient } from "@notive/db";
import { Errors, requireMembership, roleAtLeast } from "@notive/permissions";

import { type AiPreviewStore } from "../ai/preview/store";
import { defaultAiPreviewStore } from "../ai/preview/default";
import { Actions, recordActivity } from "../audit";
import { createDocumentVersionInTx } from "./document-version";

export interface SaveAiPreviewAsDocumentOptions {
  /**
   * Override the default singleton preview store. Tests inject the
   * same in-memory instance that was used by `generateAiDocument` so
   * the save service sees the same preview entry.
   */
  previewStore?: AiPreviewStore;
}

export interface SaveAiPreviewAsDocumentResult {
  document: Document;
  aiRequest: AiRequest;
  aiResult: AiResult;
}

/**
 * Persist a generated preview as a Draft document and link the AI
 * metadata so the result is traceable both ways:
 *
 *   documents.aiRequestId          -> ai_requests.id
 *   ai_results.savedDocumentId     -> documents.id
 *   ai_results.status              = Saved
 *   ai_requests.resultSaved        = true
 *
 * The new document is always created as Draft / Private / sourceType=AI
 * and is owned/authored by the session user. The visibility / status /
 * sharing model is left at the conservative default; widening happens
 * through the existing document PATCH route as a follow-up user action.
 */
export async function saveAiPreviewAsDocument(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  aiRequestId: string,
  opts: SaveAiPreviewAsDocumentOptions = {},
): Promise<SaveAiPreviewAsDocumentResult> {
  const membership = await requireMembership(prisma, userId, organizationId);

  // Requester-only: existence of another user's AI request must not
  // leak. Peer / cross-user / wrong-org / missing all collapse to
  // NOT_FOUND. The requestedByUserId check is the same shape as
  // ai-request.ts's `requireOwnAiRequest`.
  const aiRequest = await prisma.aiRequest.findFirst({
    where: { id: aiRequestId, organizationId },
  });
  if (!aiRequest || aiRequest.requestedByUserId !== userId) {
    throw Errors.notFound();
  }
  if (!roleAtLeast(membership.role, "Editor")) {
    throw Errors.forbidden("document_create_not_allowed");
  }

  if (aiRequest.status !== "Completed") {
    throw Errors.conflict("ai_request_not_saveable");
  }
  if (aiRequest.resultSaved) {
    throw Errors.conflict("ai_request_already_saved");
  }

  // Load the preview through the same store boundary the generation
  // service wrote to. The key is (org, user, aiRequest); a peer
  // would construct a different key and miss; expiry / prior discard
  // returns null here. Body retention guarantee: this is the last
  // place the body is "in memory only"; the next step writes it.
  const store = opts.previewStore ?? defaultAiPreviewStore;
  const preview = await store.load({ aiRequestId, organizationId, userId });
  if (!preview) {
    throw Errors.notFound();
  }

  // All four writes happen in one transaction. The resultSaved=false
  // precondition on the ai_request update is what guards against a
  // concurrent double-save: the loser sees count=0 and rolls back the
  // whole transaction, so the document it tentatively created is
  // discarded with it. Phase D section 9 / CLAUDE.md section 4.3.
  const result = await prisma.$transaction(async (tx) => {
    const saveableResults = await tx.aiResult.findMany({
      where: {
        aiRequestId: aiRequest.id,
        organizationId,
        status: "Generated",
        savedDocumentId: null,
      },
      select: { id: true },
    });
    const saveableResult = saveableResults[0];
    if (saveableResults.length !== 1 || saveableResult === undefined) {
      throw Errors.conflict("ai_result_not_saveable");
    }

    const doc = await tx.document.create({
      data: {
        organizationId,
        title: preview.title,
        content: preview.content,
        documentType: aiRequest.documentType,
        status: "Draft",
        ownerUserId: userId,
        authorUserId: userId,
        ownerTeamId: membership.teamId,
        visibility: "Private",
        sourceType: "AI",
        id: saveableResult.id,
        aiRequestId: aiRequest.id,
      },
    });

    await createDocumentVersionInTx(tx, {
      document: { id: doc.id, organizationId: doc.organizationId },
      title: doc.title,
      content: doc.content,
      changedByUserId: userId,
      changeSummary: "ai-save",
    });

    // Atomic guard against a concurrent second save: only flip
    // resultSaved when the row still reads `false`.
    const requestUpdate = await tx.aiRequest.updateMany({
      where: { id: aiRequest.id, organizationId, resultSaved: false },
      data: { resultSaved: true },
    });
    if (requestUpdate.count === 0) {
      throw Errors.conflict("ai_request_already_saved");
    }

    // Flip the result row in parallel. Anchored to the original
    // `Generated` status and a null savedDocumentId so a malformed
    // earlier state (e.g. status=Saved already) lands in the same
    // CONFLICT branch instead of overwriting.
    const resultUpdate = await tx.aiResult.updateMany({
      where: {
        aiRequestId: aiRequest.id,
        organizationId,
        status: "Generated",
        savedDocumentId: null,
      },
      data: { status: "Saved", savedDocumentId: doc.id },
    });
    if (resultUpdate.count === 0) {
      // No saveable result row: the request says Completed but no
      // Generated result exists. Roll back the whole tx so the new
      // document does not survive as an orphan.
      throw Errors.conflict("ai_result_not_saveable");
    }

    const updatedRequest = await tx.aiRequest.findUniqueOrThrow({
      where: { id: aiRequest.id },
    });
    const updatedResult = await tx.aiResult.findFirstOrThrow({
      where: { aiRequestId: aiRequest.id, organizationId },
    });

    return { document: doc, aiRequest: updatedRequest, aiResult: updatedResult };
  });

  // Discard the preview after the commit. Best-effort: if the store
  // call throws, the entry will age out by TTL; the linkage in the
  // DB is already correct. Audit follows the same pattern.
  try {
    await store.discard({ aiRequestId, organizationId, userId });
  } catch {
    // intentionally swallowed
  }

  await recordActivity(prisma, {
    organizationId,
    actorUserId: userId,
    action: Actions.DOCUMENT_CREATED,
    targetType: "document",
    targetId: result.document.id,
    metadata: {
      title: result.document.title,
      documentType: result.document.documentType,
      visibility: result.document.visibility,
      source: "ai",
      aiRequestId: aiRequest.id,
    },
  });

  return result;
}
