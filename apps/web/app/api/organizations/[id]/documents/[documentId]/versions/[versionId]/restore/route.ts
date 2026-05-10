import { prisma } from "@notive/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { respondError } from "@/lib/http";
import { getCurrentSession } from "@/lib/session";
import { restoreDocumentVersion } from "@/lib/services/document-version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: { id: string; documentId: string; versionId: string };
}

export async function POST(_req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    const { document, newVersion } = await restoreDocumentVersion(
      prisma,
      user.id,
      params.id,
      params.documentId,
      params.versionId,
    );
    return NextResponse.json({
      document: {
        id: document.id,
        organizationId: document.organizationId,
        title: document.title,
        content: document.content,
        documentType: document.documentType,
        status: document.status,
        ownerUserId: document.ownerUserId,
        authorUserId: document.authorUserId,
        ownerTeamId: document.ownerTeamId,
        visibility: document.visibility,
        sourceType: document.sourceType,
        createdAt: document.createdAt.toISOString(),
        updatedAt: document.updatedAt.toISOString(),
        deletedAt: document.deletedAt ? document.deletedAt.toISOString() : null,
      },
      newVersion: {
        id: newVersion.id,
        versionNumber: newVersion.versionNumber,
        titleSnapshot: newVersion.titleSnapshot,
        contentSnapshot: newVersion.contentSnapshot,
        changedByUserId: newVersion.changedByUserId,
        changeSummary: newVersion.changeSummary,
        createdAt: newVersion.createdAt.toISOString(),
      },
    });
  } catch (err) {
    return respondError(err);
  }
}
