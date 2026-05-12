// AI document generation service (Phase D step 2).
//
// Composes the Step 1 AI metadata service with a provider adapter to
// drive a single AI request through its full lifecycle:
//
//   1. createAiRequest           (Pending — Viewer rejected here)
//   2. resolve + permission-filter references
//   3. transition Pending  → Processing
//   4. provider.generate         (mock by default, no network)
//   5. transition Processing → Completed | Failed
//   6. recordAiResult            (Generated on success, Failed on miss)
//   7. recordAiReferences        (audit snapshot for allowed + blocked)
//
// Body retention policy (Phase A §15 / CLAUDE.md §4.4–§4.5):
//   - Prompt and preview body NEVER reach the DB. The only free-text
//     fields persisted are the structured generation tags
//     (`documentType`, `purpose`, `audience`, `tone`) — these are
//     user-selected metadata, not the assembled prompt.
//   - The preview `{ title, content }` is returned to the caller in
//     memory only. The Redis-backed preview store and the editor /
//     documents-save handoff that consume it are deferred to later
//     Phase D steps.
//
// Reference permission policy (CLAUDE.md §4.5):
//   - Each requested reference id is evaluated through
//     `evaluateDocumentPermission` against the requesting actor.
//   - References the actor cannot view (cross-org, soft-deleted, no
//     grant) are recorded with `accessAllowed: false` and DROPPED
//     from the provider input. The provider only sees ids the user
//     could open today. Same gate as search will use in Phase F.
//
// Requester-only access (Phase D plan §9.3):
//   - All metadata-service calls flow through Step 1's
//     `requireOwnAiRequest`, so a same-org peer cannot poke at
//     another user's request via this service.
//
// Failure handling:
//   - Provider throw → request to Failed, result with status=Failed
//     and errorCode, references still recorded (audit captures the
//     attempt). The envelope returns `preview: null`; the service
//     does NOT rethrow so the caller can render the §11.1 "재시도 /
//     요청 수정" UI without a 5xx branch.
//   - Membership / Viewer rejection / validation are still raised as
//     ApiError because they are policy violations, not generation
//     failures.

import type { AiReference, AiRequest, AiResult, Document, PrismaClient } from "@notive/db";
import {
  type DocumentActor,
  type DocumentContext,
  type DocumentShareGrant,
  Errors,
  evaluateDocumentPermission,
  requireMembership,
} from "@notive/permissions";

import {
  type RecordAiReferenceInput,
  createAiRequest,
  recordAiReferences,
  recordAiResult,
  transitionAiRequestStatus,
} from "./ai-request";
import { type AiProvider, createMockAiProvider, MockProviderError } from "../ai/provider/mock";

// ---------------------------------------------------------------------
// Inputs / outputs
// ---------------------------------------------------------------------

const MAX_REFERENCES = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface GenerateAiDocumentInput {
  documentType: string;
  templateId?: string | null;
  purpose?: string | null;
  audience?: string | null;
  tone?: string | null;
  /**
   * IDs of existing documents to use as reference material. Each id
   * is filtered through the View permission gate before being passed
   * to the provider; ids the actor cannot view are still recorded in
   * the audit snapshot with `accessAllowed: false`.
   */
  referenceDocumentIds?: ReadonlyArray<string>;
}

export interface GenerateAiDocumentResult {
  aiRequest: AiRequest;
  aiResult: AiResult;
  references: AiReference[];
  /**
   * Generated body envelope. NEVER persisted at this step — the
   * editor / save handoff that writes it to `documents` is a later
   * Phase D step. `null` when the request transitioned to Failed.
   */
  preview: { title: string; content: string } | null;
}

export interface GenerateAiDocumentOptions {
  /**
   * Override the default mock provider. Tests inject a custom
   * provider to drive the Failed lifecycle deterministically.
   */
  provider?: AiProvider;
}

// ---------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------

function actorFromMembership(m: {
  userId: string;
  organizationId: string;
  role: DocumentActor["role"];
  teamId: string | null;
}): DocumentActor {
  return {
    userId: m.userId,
    organizationId: m.organizationId,
    role: m.role,
    teamId: m.teamId,
  };
}

function contextFromRow(d: Document): DocumentContext {
  return {
    id: d.id,
    organizationId: d.organizationId,
    status: d.status,
    authorUserId: d.authorUserId,
    ownerUserId: d.ownerUserId,
    ownerTeamId: d.ownerTeamId,
    visibility: d.visibility,
    deletedAt: d.deletedAt,
  };
}

interface DocumentRowWithShares extends Document {
  shares: Array<{
    targetType: DocumentShareGrant["targetType"];
    targetId: string;
    permission: DocumentShareGrant["permission"];
  }>;
}

interface ResolvedReferences {
  /** Refs that passed the View gate. Only these reach the provider. */
  allowed: Array<{ id: string; title: string | null }>;
  /** Audit snapshot for ALL requested refs (allowed + blocked). */
  records: RecordAiReferenceInput[];
}

/**
 * Build the allowed-refs list and the audit-records list from the
 * raw requested ids. Same-org documents only — a cross-org id is
 * indistinguishable from a non-existent id at this layer and lands
 * in the `accessAllowed: false` bucket.
 */
async function resolveReferences(
  prisma: PrismaClient,
  actor: DocumentActor,
  ids: ReadonlyArray<string>,
): Promise<ResolvedReferences> {
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) {
    return { allowed: [], records: [] };
  }
  const rows = (await prisma.document.findMany({
    where: { id: { in: uniqueIds }, organizationId: actor.organizationId },
    include: {
      shares: {
        select: { targetType: true, targetId: true, permission: true },
      },
    },
  })) as DocumentRowWithShares[];
  const byId = new Map(rows.map((r) => [r.id, r]));

  const allowed: ResolvedReferences["allowed"] = [];
  const records: RecordAiReferenceInput[] = [];

  for (const id of uniqueIds) {
    const row = byId.get(id);
    if (!row) {
      records.push({
        targetType: "Document",
        targetId: id,
        targetTitle: null,
        accessAllowed: false,
      });
      continue;
    }
    const ctx = contextFromRow(row);
    const grant = evaluateDocumentPermission(actor, ctx, row.shares);
    if (grant === null) {
      records.push({
        targetType: "Document",
        targetId: id,
        targetTitle: null,
        accessAllowed: false,
      });
      continue;
    }
    allowed.push({ id, title: row.title });
    records.push({
      targetType: "Document",
      targetId: id,
      targetTitle: row.title,
      accessAllowed: true,
    });
  }

  return { allowed, records };
}

// ---------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------

/**
 * Run an AI document generation end-to-end on top of the Step 1
 * metadata service. The default provider is the deterministic mock;
 * tests inject a custom provider to drive the Failed lifecycle.
 *
 * Returns an envelope. The lifecycle always reaches a terminal state
 * (Completed or Failed) before this function returns. The caller
 * holds the preview body in memory and is responsible for the
 * subsequent save flow.
 */
export async function generateAiDocument(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  input: GenerateAiDocumentInput,
  opts: GenerateAiDocumentOptions = {},
): Promise<GenerateAiDocumentResult> {
  if (
    input.referenceDocumentIds !== undefined &&
    input.referenceDocumentIds.length > MAX_REFERENCES
  ) {
    throw Errors.invalid(`too many references (max ${MAX_REFERENCES})`);
  }
  if (input.referenceDocumentIds?.some((id) => !UUID_RE.test(id))) {
    throw Errors.invalid("invalid referenceDocumentIds");
  }

  const membership = await requireMembership(prisma, userId, organizationId);
  const actor = actorFromMembership(membership);

  // Step 1 metadata service handles Viewer rejection +
  // organization-boundary NOT_FOUND. We don't duplicate the checks.
  const aiRequest = await createAiRequest(prisma, userId, organizationId, {
    documentType: input.documentType,
    templateId: input.templateId ?? null,
    purpose: input.purpose ?? null,
    audience: input.audience ?? null,
    tone: input.tone ?? null,
  });

  // Reference filter runs BEFORE the provider call. Cross-org / no-
  // view ids land in the audit snapshot but never enter the provider
  // input.
  const refs = await resolveReferences(prisma, actor, input.referenceDocumentIds ?? []);

  await transitionAiRequestStatus(prisma, userId, organizationId, aiRequest.id, "Processing");

  const provider = opts.provider ?? createMockAiProvider();
  let providerOutput: Awaited<ReturnType<AiProvider["generate"]>> | null = null;
  let failureCode: string | null = null;
  try {
    providerOutput = await provider.generate({
      documentType: input.documentType,
      templateId: input.templateId ?? null,
      purpose: input.purpose ?? null,
      audience: input.audience ?? null,
      tone: input.tone ?? null,
      references: refs.allowed,
    });
  } catch (e) {
    failureCode = e instanceof MockProviderError ? e.errorCode : "provider_unknown_error";
  }

  if (providerOutput) {
    const completed = await transitionAiRequestStatus(
      prisma,
      userId,
      organizationId,
      aiRequest.id,
      "Completed",
      {
        latencyMs: providerOutput.latencyMs,
        tokenCountInput: providerOutput.tokenCountInput,
        tokenCountOutput: providerOutput.tokenCountOutput,
      },
    );
    const result = await recordAiResult(prisma, userId, organizationId, aiRequest.id, {
      status: "Generated",
    });
    const recordedRefs = await recordAiReferences(
      prisma,
      userId,
      organizationId,
      aiRequest.id,
      refs.records,
    );
    return {
      aiRequest: completed,
      aiResult: result,
      references: recordedRefs,
      preview: { title: providerOutput.title, content: providerOutput.content },
    };
  }

  const code = failureCode ?? "provider_unknown_error";
  const failed = await transitionAiRequestStatus(
    prisma,
    userId,
    organizationId,
    aiRequest.id,
    "Failed",
    { errorCode: code },
  );
  const failedResult = await recordAiResult(prisma, userId, organizationId, aiRequest.id, {
    status: "Failed",
    errorCode: code,
  });
  const recordedRefs = await recordAiReferences(
    prisma,
    userId,
    organizationId,
    aiRequest.id,
    refs.records,
  );
  return {
    aiRequest: failed,
    aiResult: failedResult,
    references: recordedRefs,
    preview: null,
  };
}
