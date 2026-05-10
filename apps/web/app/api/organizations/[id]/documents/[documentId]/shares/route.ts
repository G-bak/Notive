import { prisma } from "@notive/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { readJson, respondError } from "@/lib/http";
import { getCurrentSession } from "@/lib/session";
import { listDocumentShares, replaceDocumentShares } from "@/lib/services/document-share";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: { id: string; documentId: string };
}

function serialize(s: Awaited<ReturnType<typeof listDocumentShares>>[number]) {
  return {
    id: s.id,
    documentId: s.documentId,
    organizationId: s.organizationId,
    targetType: s.targetType,
    targetId: s.targetId,
    permission: s.permission,
    createdByUserId: s.createdByUserId,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export async function GET(_req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    const shares = await listDocumentShares(prisma, user.id, params.id, params.documentId);
    return NextResponse.json({ shares: shares.map(serialize) });
  } catch (err) {
    return respondError(err);
  }
}

export async function PUT(req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    const body = await readJson(req);
    const shares = await replaceDocumentShares(prisma, user.id, params.id, params.documentId, body);
    return NextResponse.json({ shares: shares.map(serialize) });
  } catch (err) {
    return respondError(err);
  }
}
