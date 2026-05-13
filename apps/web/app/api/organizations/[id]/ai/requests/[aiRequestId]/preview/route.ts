// AI preview load / discard route (Phase D step 4).
//
// Read and lifecycle endpoints for the short-term AI preview store
// from Step 3. Both methods rely on `getCurrentSession` for the
// actor: a same-org peer cannot read or affect another user's
// preview because the underlying store key includes the session
// userId. `userId` is never read from query string, body, or path
// params on this route.
//
// Envelope mapping:
//   - GET success -> 200 with the preview record envelope.
//   - DELETE success -> 204 with no body (idempotent: peer / absent
//     entry both return 204).
//   - cross-org actor / wrong-user / expired / discarded ->
//     respondError maps the service's NOT_FOUND to `{ error:
//     "NOT_FOUND" }` with no `reason_code` (Phase A section 15 existence-
//     leak guard).

import { prisma } from "@notive/db";
import { Errors } from "@notive/permissions";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { respondError } from "@/lib/http";
import { getCurrentSession } from "@/lib/session";
import { discardAiPreview, loadAiPreview } from "@/lib/services/ai-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: { id: string; aiRequestId: string };
}

// Reject malformed aiRequestId at the route layer so a junk path
// segment cannot reach Prisma and surface as INTERNAL_ERROR via
// Postgres uuid-parse. Same shape used by Phase C step 7 / step 8
// route handlers.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(value: string, field: string): void {
  if (!UUID_RE.test(value)) {
    throw Errors.invalid(`invalid ${field}`);
  }
}

export async function GET(_req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    requireUuid(params.aiRequestId, "aiRequestId");
    const record = await loadAiPreview(prisma, user.id, params.id, params.aiRequestId);
    return NextResponse.json({
      aiRequestId: record.aiRequestId,
      organizationId: record.organizationId,
      userId: record.userId,
      title: record.title,
      content: record.content,
      createdAt: record.createdAt.toISOString(),
      expiresAt: record.expiresAt.toISOString(),
    });
  } catch (err) {
    return respondError(err);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    requireUuid(params.aiRequestId, "aiRequestId");
    await discardAiPreview(prisma, user.id, params.id, params.aiRequestId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return respondError(err);
  }
}
