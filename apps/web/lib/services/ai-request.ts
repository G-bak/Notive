// AI request metadata service (Phase D step 1).
//
// Scope of this step:
//   - Create an `ai_requests` row for a new generation request.
//   - Transition status: Pending → Processing → Completed | Failed | Cancelled.
//   - Record an `ai_results` row for the produced result metadata.
//   - Record `ai_references` rows for the materials used.
//
// Out of scope (later Phase D steps):
//   - Provider call (mock-first).
//   - Prompt assembly / preview body persistence (Redis).
//   - Result content storage — that happens in the documents save flow.
//   - Permission filtering of references — see §9.2 of the AI policy.
//     Callers must filter the reference list through
//     `evaluateDocumentPermission` BEFORE invoking `recordAiReferences`;
//     this service records the snapshot exactly as given.
//   - Saved-document linkage (`ai_results.saved_document_id` / inverse
//     `documents.ai_request_id` flow) — set by the documents service in
//     a follow-up step.
//
// Permission policy:
//   - Every entry point starts with `requireMembership`.
//   - `createAiRequest` rejects Viewer with FORBIDDEN
//     `ai_request_create_not_allowed` (Phase D plan §9.1).
//   - Cross-org access maps to NOT_FOUND (existence-leak guard, Phase A
//     §15 / Phase C established pattern).
//   - Actor-ownership: `transitionAiRequestStatus`, `recordAiResult`,
//     and `recordAiReferences` operate only on the requester's own AI
//     request. A same-org peer who did not initiate the request gets
//     NOT_FOUND (no FORBIDDEN — existence of another user's request is
//     not advertised). Phase D §9.3 "결과 접근 권한 = 요청 사용자만
//     기본 접근 가능"; admin-side log review is a separate follow-up
//     step and does not flow through these entry points.
//
// Body-retention policy (Phase A §15 / DB design §9):
//   - This service NEVER stores prompt text or response body. The input
//     types intentionally do not include `requestText`, `prompt`,
//     `content`, or `response` fields. The schema columns do not exist.
//   - Free-text error messages are not stored either; only the short
//     `errorCode` is kept.

import type {
  AiReference,
  AiReferenceTargetType,
  AiRequest,
  AiRequestStatus,
  AiResult,
  AiResultStatus,
  PrismaClient,
} from "@notive/db";
import { Errors, requireMembership } from "@notive/permissions";

// ---------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------

/**
 * Input for `createAiRequest`. Intentionally does NOT include any
 * free-text prompt / body field. Structured generation tags only.
 */
export interface CreateAiRequestInput {
  documentType: string;
  templateId?: string | null;
  purpose?: string | null;
  audience?: string | null;
  tone?: string | null;
}

/**
 * Optional metadata recorded alongside a status transition. Populated
 * by the provider adapter when finishing a request (latency / tokens /
 * errorCode), or by the cancel path (errorCode only).
 */
export interface AiRequestTransitionMeta {
  errorCode?: string | null;
  latencyMs?: number | null;
  tokenCountInput?: number | null;
  tokenCountOutput?: number | null;
}

/**
 * Input for `recordAiResult`. Title / content snapshots are not stored
 * — preview body lives in session-bound storage, and persisted body
 * lives only in `documents` after explicit save.
 */
export interface RecordAiResultInput {
  status?: AiResultStatus;
  errorCode?: string | null;
}

/**
 * Input for a single reference row. The caller MUST have filtered the
 * list through the document permission gate before passing entries
 * with `accessAllowed: true`; this service records the snapshot as
 * given (it is an audit record, not a gate).
 */
export interface RecordAiReferenceInput {
  targetType: AiReferenceTargetType;
  targetId: string;
  targetTitle?: string | null;
  accessAllowed: boolean;
}

// ---------------------------------------------------------------------
// Status transition policy
// ---------------------------------------------------------------------

const ALLOWED_TRANSITIONS: Record<AiRequestStatus, ReadonlyArray<AiRequestStatus>> = {
  Pending: ["Processing", "Cancelled", "Failed"],
  Processing: ["Completed", "Failed", "Cancelled"],
  Completed: [],
  Failed: [],
  Cancelled: [],
};

function isTerminal(status: AiRequestStatus): boolean {
  return status === "Completed" || status === "Failed" || status === "Cancelled";
}

// ---------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------

async function loadAiRequest(
  prisma: PrismaClient,
  organizationId: string,
  requestId: string,
): Promise<AiRequest | null> {
  return prisma.aiRequest.findFirst({
    where: { id: requestId, organizationId },
  });
}

/**
 * Load an AI request and enforce that the caller is the original
 * requester. Cross-org / missing / not-yours all collapse to
 * `NOT_FOUND` so a same-org peer cannot probe for the existence of
 * another user's AI request by id.
 */
async function requireOwnAiRequest(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  requestId: string,
): Promise<AiRequest> {
  const row = await loadAiRequest(prisma, organizationId, requestId);
  if (!row) {
    throw Errors.notFound();
  }
  if (row.requestedByUserId !== userId) {
    throw Errors.notFound();
  }
  return row;
}

// ---------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------

/**
 * Create a new AI request row in `Pending`. The prompt body is NOT a
 * field on the input; only the structured generation tags reach this
 * function. Viewer role is rejected (Phase D plan §9.1).
 */
export async function createAiRequest(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  input: CreateAiRequestInput,
): Promise<AiRequest> {
  const membership = await requireMembership(prisma, userId, organizationId);
  if (membership.role === "Viewer") {
    throw Errors.forbidden("ai_request_create_not_allowed");
  }
  return prisma.aiRequest.create({
    data: {
      organizationId,
      requestedByUserId: userId,
      documentType: input.documentType,
      templateId: input.templateId ?? null,
      purpose: input.purpose ?? null,
      audience: input.audience ?? null,
      tone: input.tone ?? null,
      status: "Pending",
    },
  });
}

/**
 * Move an AI request through its lifecycle. Lifecycle is:
 *
 *   Pending     → Processing | Cancelled | Failed
 *   Processing  → Completed  | Failed    | Cancelled
 *   Completed / Failed / Cancelled → terminal (no transitions)
 *
 * Invalid transitions throw `CONFLICT` (the request exists but the
 * target status is not reachable from the current one). Cross-org or
 * missing requests throw `NOT_FOUND`.
 *
 * On entering `Processing`, `startedAt` is set if not already present.
 * On entering a terminal status, `completedAt` is set. Optional
 * `latencyMs`, `tokenCountInput`, `tokenCountOutput`, `errorCode` are
 * persisted when provided.
 */
export async function transitionAiRequestStatus(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  requestId: string,
  toStatus: AiRequestStatus,
  meta: AiRequestTransitionMeta = {},
): Promise<AiRequest> {
  await requireMembership(prisma, userId, organizationId);
  const row = await requireOwnAiRequest(prisma, userId, organizationId, requestId);
  const allowed = ALLOWED_TRANSITIONS[row.status] ?? [];
  if (!allowed.includes(toStatus)) {
    throw Errors.conflict("ai_request_status_transition_invalid");
  }
  const now = new Date();
  return prisma.aiRequest.update({
    where: { id: requestId },
    data: {
      status: toStatus,
      startedAt: toStatus === "Processing" && row.startedAt === null ? now : undefined,
      completedAt: isTerminal(toStatus) ? now : undefined,
      errorCode: meta.errorCode !== undefined ? meta.errorCode : undefined,
      latencyMs: meta.latencyMs !== undefined ? meta.latencyMs : undefined,
      tokenCountInput: meta.tokenCountInput !== undefined ? meta.tokenCountInput : undefined,
      tokenCountOutput: meta.tokenCountOutput !== undefined ? meta.tokenCountOutput : undefined,
    },
  });
}

/**
 * Record a result metadata row for an existing AI request. The result
 * body (title / content) is NOT persisted here — only the metadata
 * envelope (status, optional error code). Cross-org or missing parent
 * requests throw `NOT_FOUND`.
 */
export async function recordAiResult(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  requestId: string,
  input: RecordAiResultInput = {},
): Promise<AiResult> {
  await requireMembership(prisma, userId, organizationId);
  await requireOwnAiRequest(prisma, userId, organizationId, requestId);
  return prisma.aiResult.create({
    data: {
      aiRequestId: requestId,
      organizationId,
      status: input.status ?? "Generated",
      errorCode: input.errorCode ?? null,
    },
  });
}

/**
 * Bulk-record reference rows for an existing AI request. The caller is
 * responsible for filtering the input through the document permission
 * gate before invoking this function — references arrive here as the
 * audit snapshot of what was actually used (or attempted), including
 * the `accessAllowed` flag.
 *
 * Cross-org or missing parent requests throw `NOT_FOUND`. Passing an
 * empty list returns an empty array without touching the DB.
 */
export async function recordAiReferences(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  requestId: string,
  refs: ReadonlyArray<RecordAiReferenceInput>,
): Promise<AiReference[]> {
  await requireMembership(prisma, userId, organizationId);
  await requireOwnAiRequest(prisma, userId, organizationId, requestId);
  if (refs.length === 0) return [];
  // createMany does not return the inserted rows on Postgres in Prisma,
  // so we use a per-row create inside a transaction to keep the API
  // shape consistent with the rest of the service layer. Phase D step 1
  // volumes are small (one request typically has a handful of refs).
  return prisma.$transaction(
    refs.map((r) =>
      prisma.aiReference.create({
        data: {
          aiRequestId: requestId,
          organizationId,
          targetType: r.targetType,
          targetId: r.targetId,
          targetTitle: r.targetTitle ?? null,
          accessAllowed: r.accessAllowed,
        },
      }),
    ),
  );
}
