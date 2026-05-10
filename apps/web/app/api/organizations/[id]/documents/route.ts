import { prisma } from "@notive/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { readJson, respondError } from "@/lib/http";
import { getCurrentSession } from "@/lib/session";
import { createDocument, listDocuments } from "@/lib/services/document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: { id: string };
}

function serialize(d: Awaited<ReturnType<typeof createDocument>>) {
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
  };
}

export async function GET(_req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    const docs = await listDocuments(prisma, user.id, params.id);
    return NextResponse.json({ documents: docs.map(serialize) });
  } catch (err) {
    return respondError(err);
  }
}

export async function POST(req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    const body = await readJson(req);
    const doc = await createDocument(prisma, user.id, params.id, body);
    return NextResponse.json(serialize(doc), { status: 201 });
  } catch (err) {
    return respondError(err);
  }
}
