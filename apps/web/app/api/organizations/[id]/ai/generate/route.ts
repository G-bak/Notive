// AI document generation route (Phase D step 4).
//
// Wraps the Step 2 `generateAiDocument` service with the standard
// session + envelope mapping. The session user is the ONLY actor
// source: any `userId` field in the request body is ignored (not
// trusted, not validated, not echoed back). The route never accepts
// `userId` from query string or path params either.
//
// Lifecycle and body retention:
//   - The service drives Pending -> Processing -> Completed | Failed
//     and writes the preview body to the short-term store on
//     Completed. The route returns 201 in both Completed and Failed
//     cases because the AI request lifecycle ran to a terminal state
//     successfully; `preview: null` distinguishes the Failed branch
//     so the editor can render the retry / edit-request UI without a
//     5xx branch.
//   - Permission failures (Viewer, cross-org) still surface as
//     FORBIDDEN / NOT_FOUND via `respondError`.

import { prisma } from "@notive/db";
import { Errors } from "@notive/permissions";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { readJson, respondError } from "@/lib/http";
import { getCurrentSession } from "@/lib/session";
import { type GenerateAiDocumentInput, generateAiDocument } from "@/lib/services/ai-generation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: { id: string };
}

function isNullableString(v: unknown): v is string | null | undefined {
  return v === null || v === undefined || typeof v === "string";
}

function parseInput(raw: unknown): GenerateAiDocumentInput {
  if (raw === null || typeof raw !== "object") {
    throw Errors.invalid("invalid body");
  }
  const b = raw as Record<string, unknown>;

  if (typeof b.documentType !== "string" || b.documentType.length === 0) {
    throw Errors.invalid("documentType required");
  }
  if (!isNullableString(b.templateId)) throw Errors.invalid("invalid templateId");
  if (!isNullableString(b.purpose)) throw Errors.invalid("invalid purpose");
  if (!isNullableString(b.audience)) throw Errors.invalid("invalid audience");
  if (!isNullableString(b.tone)) throw Errors.invalid("invalid tone");

  const input: GenerateAiDocumentInput = { documentType: b.documentType };
  if (b.templateId !== undefined) input.templateId = (b.templateId as string | null) ?? null;
  if (b.purpose !== undefined) input.purpose = (b.purpose as string | null) ?? null;
  if (b.audience !== undefined) input.audience = (b.audience as string | null) ?? null;
  if (b.tone !== undefined) input.tone = (b.tone as string | null) ?? null;

  if (b.referenceDocumentIds !== undefined && b.referenceDocumentIds !== null) {
    if (
      !Array.isArray(b.referenceDocumentIds) ||
      !b.referenceDocumentIds.every((x) => typeof x === "string")
    ) {
      throw Errors.invalid("invalid referenceDocumentIds");
    }
    input.referenceDocumentIds = b.referenceDocumentIds as string[];
  }
  // NOTE: `userId` from body is intentionally NOT read. The route
  // always uses the session user; the body field (if present) is
  // ignored without validation or echo.
  return input;
}

function serialize(out: Awaited<ReturnType<typeof generateAiDocument>>) {
  const req = out.aiRequest;
  return {
    aiRequest: {
      id: req.id,
      organizationId: req.organizationId,
      requestedByUserId: req.requestedByUserId,
      status: req.status,
      documentType: req.documentType,
      templateId: req.templateId,
      purpose: req.purpose,
      audience: req.audience,
      tone: req.tone,
      errorCode: req.errorCode,
      latencyMs: req.latencyMs,
      tokenCountInput: req.tokenCountInput,
      tokenCountOutput: req.tokenCountOutput,
      startedAt: req.startedAt ? req.startedAt.toISOString() : null,
      completedAt: req.completedAt ? req.completedAt.toISOString() : null,
      createdAt: req.createdAt.toISOString(),
      updatedAt: req.updatedAt.toISOString(),
    },
    aiResult: {
      id: out.aiResult.id,
      aiRequestId: out.aiResult.aiRequestId,
      status: out.aiResult.status,
      errorCode: out.aiResult.errorCode,
      createdAt: out.aiResult.createdAt.toISOString(),
    },
    references: out.references.map((r) => ({
      id: r.id,
      targetType: r.targetType,
      targetId: r.targetId,
      targetTitle: r.targetTitle,
      accessAllowed: r.accessAllowed,
    })),
    preview:
      out.preview === null
        ? null
        : {
            aiRequestId: req.id,
            title: out.preview.title,
            content: out.preview.content,
            expiresAt: out.preview.expiresAt.toISOString(),
          },
  };
}

export async function POST(req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    const body = await readJson(req);
    const input = parseInput(body);
    const out = await generateAiDocument(prisma, user.id, params.id, input);
    return NextResponse.json(serialize(out), { status: 201 });
  } catch (err) {
    return respondError(err);
  }
}
