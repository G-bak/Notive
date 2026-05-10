import { prisma } from "@notive/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { respondError } from "@/lib/http";
import { getCurrentSession } from "@/lib/session";
import { listRecentDocuments } from "@/lib/services/document-view-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: { id: string };
}

function serializeDoc(d: Awaited<ReturnType<typeof listRecentDocuments>>[number]["document"]) {
  return {
    id: d.id,
    organizationId: d.organizationId,
    title: d.title,
    documentType: d.documentType,
    status: d.status,
    ownerUserId: d.ownerUserId,
    authorUserId: d.authorUserId,
    ownerTeamId: d.ownerTeamId,
    visibility: d.visibility,
    sourceType: d.sourceType,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

export async function GET(req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    const url = new URL(req.url);
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam !== null ? Number(limitParam) : undefined;
    const entries = await listRecentDocuments(prisma, user.id, params.id, { limit });
    return NextResponse.json({
      recent: entries.map((e) => ({
        document: serializeDoc(e.document),
        viewedAt: e.viewedAt.toISOString(),
      })),
    });
  } catch (err) {
    return respondError(err);
  }
}
