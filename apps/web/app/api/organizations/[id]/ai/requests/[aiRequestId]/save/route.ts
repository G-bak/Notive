// AI preview save-to-document route (Phase D step 5).
//
// POST /api/organizations/[id]/ai/requests/[aiRequestId]/save
//
// Explicit user action that promotes a short-term preview into a
// permanent Draft document. The route is intentionally narrow:
//   - Session user is the only actor source (no body fields trusted).
//   - aiRequestId comes from the URL only; any aiRequestId / sourceType
//     / content / userId field in the body is ignored.
//   - The route does not accept a request body at all; generation
//     metadata is already on the ai_request row and the preview body
//     is already in the store. There is nothing for the client to
//     supply.

import { prisma } from "@notive/db";
import { Errors } from "@notive/permissions";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { respondError } from "@/lib/http";
import { getCurrentSession } from "@/lib/session";
import { saveAiPreviewAsDocument } from "@/lib/services/ai-document-save";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: { id: string; aiRequestId: string };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(value: string, field: string): void {
  if (!UUID_RE.test(value)) {
    throw Errors.invalid(`invalid ${field}`);
  }
}

function serialize(out: Awaited<ReturnType<typeof saveAiPreviewAsDocument>>) {
  const d = out.document;
  return {
    document: {
      id: d.id,
      organizationId: d.organizationId,
      title: d.title,
      content: d.content,
      documentType: d.documentType,
      status: d.status,
      ownerUserId: d.ownerUserId,
      authorUserId: d.authorUserId,
      ownerTeamId: d.ownerTeamId,
      visibility: d.visibility,
      sourceType: d.sourceType,
      aiRequestId: d.aiRequestId,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    },
    aiRequest: {
      id: out.aiRequest.id,
      status: out.aiRequest.status,
      resultSaved: out.aiRequest.resultSaved,
    },
    aiResult: {
      id: out.aiResult.id,
      status: out.aiResult.status,
      savedDocumentId: out.aiResult.savedDocumentId,
    },
  };
}

export async function POST(_req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    requireUuid(params.aiRequestId, "aiRequestId");
    const out = await saveAiPreviewAsDocument(prisma, user.id, params.id, params.aiRequestId);
    return NextResponse.json(serialize(out), { status: 201 });
  } catch (err) {
    return respondError(err);
  }
}
