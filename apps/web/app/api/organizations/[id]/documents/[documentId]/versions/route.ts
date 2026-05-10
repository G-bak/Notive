import { prisma } from "@notive/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { respondError } from "@/lib/http";
import { getCurrentSession } from "@/lib/session";
import { listDocumentVersions } from "@/lib/services/document-version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: { id: string; documentId: string };
}

function serialize(v: Awaited<ReturnType<typeof listDocumentVersions>>[number]) {
  return {
    id: v.id,
    documentId: v.documentId,
    organizationId: v.organizationId,
    versionNumber: v.versionNumber,
    titleSnapshot: v.titleSnapshot,
    contentSnapshot: v.contentSnapshot,
    changedByUserId: v.changedByUserId,
    changeSummary: v.changeSummary,
    createdAt: v.createdAt.toISOString(),
  };
}

export async function GET(_req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    const versions = await listDocumentVersions(prisma, user.id, params.id, params.documentId);
    return NextResponse.json({ versions: versions.map(serialize) });
  } catch (err) {
    return respondError(err);
  }
}
