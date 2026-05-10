import { prisma } from "@notive/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { respondError } from "@/lib/http";
import { getCurrentSession } from "@/lib/session";
import { getDocumentVersion } from "@/lib/services/document-version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: { id: string; documentId: string; versionId: string };
}

export async function GET(_req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    const v = await getDocumentVersion(
      prisma,
      user.id,
      params.id,
      params.documentId,
      params.versionId,
    );
    return NextResponse.json({
      id: v.id,
      documentId: v.documentId,
      organizationId: v.organizationId,
      versionNumber: v.versionNumber,
      titleSnapshot: v.titleSnapshot,
      contentSnapshot: v.contentSnapshot,
      changedByUserId: v.changedByUserId,
      changeSummary: v.changeSummary,
      createdAt: v.createdAt.toISOString(),
    });
  } catch (err) {
    return respondError(err);
  }
}
