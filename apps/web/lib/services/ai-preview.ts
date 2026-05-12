// AI preview read/discard service (Phase D step 3).
//
// Wraps the short-term AI preview store with the project's standard
// permission gates:
//
//   - `requireMembership` first → non-members of the org get
//     NOT_FOUND (existence-leak guard, Phase A §15).
//   - Store key includes the requesting userId, so a same-org peer
//     who asks for another user's `aiRequestId` looks up a key that
//     does not exist and gets NOT_FOUND.
//   - Expired or discarded entries return NOT_FOUND.
//
// The body retention rule (Phase A §15 / CLAUDE.md §4.4) is upheld:
// the preview body lives only in the short-term store and is never
// copied into a permanent DB row by this service. The eventual
// editor / save-to-document handoff is a separate Phase D step and
// will explicitly call into `apps/web/lib/services/document` to
// persist a new `documents` row when the user chooses to save.

import type { PrismaClient } from "@notive/db";
import { Errors, requireMembership } from "@notive/permissions";

import { type AiPreviewRecord, type AiPreviewStore } from "../ai/preview/store";
import { defaultAiPreviewStore } from "../ai/preview/default";

export interface AiPreviewServiceOptions {
  /** Override the default singleton store. Tests inject a clock-
   *  controlled in-memory instance to drive TTL expiry. */
  store?: AiPreviewStore;
}

/**
 * Load a preview body for the requesting user. Returns the stored
 * envelope or throws `NOT_FOUND` when the entry is missing for any
 * of the policy reasons (no membership, wrong user, wrong org,
 * expired, discarded).
 *
 * The returned record carries `userId`, `organizationId`, `createdAt`
 * and `expiresAt` alongside the body so the caller can render UI
 * (e.g. "expires in N minutes") without a second store call.
 */
export async function loadAiPreview(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  aiRequestId: string,
  opts: AiPreviewServiceOptions = {},
): Promise<AiPreviewRecord> {
  await requireMembership(prisma, userId, organizationId);
  const store = opts.store ?? defaultAiPreviewStore;
  const row = await store.load({ aiRequestId, organizationId, userId });
  if (!row) {
    throw Errors.notFound();
  }
  return row;
}

/**
 * Discard a preview body. Idempotent — succeeds silently when the
 * key is already absent. Membership is still required so a stranger
 * cannot probe for the existence of an `aiRequestId` by observing
 * differing response codes.
 */
export async function discardAiPreview(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  aiRequestId: string,
  opts: AiPreviewServiceOptions = {},
): Promise<void> {
  await requireMembership(prisma, userId, organizationId);
  const store = opts.store ?? defaultAiPreviewStore;
  await store.discard({ aiRequestId, organizationId, userId });
}
