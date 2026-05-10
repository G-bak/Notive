import { prisma } from "@notive/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { readJson, respondError } from "@/lib/http";
import { getCurrentSession } from "@/lib/session";
import { deleteDocument, getDocument, updateDocument } from "@/lib/services/document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: { id: string; documentId: string };
}

function serialize(d: Awaited<ReturnType<typeof updateDocument>>) {
  return {
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
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    deletedAt: d.deletedAt ? d.deletedAt.toISOString() : null,
  };
}

export async function GET(_req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    const { document, permission } = await getDocument(
      prisma,
      user.id,
      params.id,
      params.documentId,
    );
    return NextResponse.json({ ...serialize(document), permission });
  } catch (err) {
    return respondError(err);
  }
}

export async function PATCH(req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    const body = await readJson(req);
    const doc = await updateDocument(prisma, user.id, params.id, params.documentId, body);
    return NextResponse.json(serialize(doc));
  } catch (err) {
    return respondError(err);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    const doc = await deleteDocument(prisma, user.id, params.id, params.documentId);
    return NextResponse.json(serialize(doc));
  } catch (err) {
    return respondError(err);
  }
}
