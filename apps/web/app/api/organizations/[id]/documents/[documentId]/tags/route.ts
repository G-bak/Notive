import { prisma } from "@notive/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { readJson, respondError } from "@/lib/http";
import { getCurrentSession } from "@/lib/session";
import { setDocumentTags } from "@/lib/services/document-tag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: { id: string; documentId: string };
}

export async function PUT(req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    const body = await readJson(req);
    const result = await setDocumentTags(prisma, user.id, params.id, params.documentId, body);
    return NextResponse.json({
      tags: result.tags.map((t) => ({
        id: t.id,
        organizationId: t.organizationId,
        name: t.name,
        color: t.color,
        createdByUserId: t.createdByUserId,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
      diff: { added: result.added, removed: result.removed, total: result.total },
    });
  } catch (err) {
    return respondError(err);
  }
}
