import { prisma } from "@notive/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { readJson, respondError } from "@/lib/http";
import { getCurrentSession } from "@/lib/session";
import { createTag, listTags } from "@/lib/services/document-tag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: { id: string };
}

function serialize(t: Awaited<ReturnType<typeof listTags>>[number]) {
  return {
    id: t.id,
    organizationId: t.organizationId,
    name: t.name,
    color: t.color,
    createdByUserId: t.createdByUserId,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export async function GET(_req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    const tags = await listTags(prisma, user.id, params.id);
    return NextResponse.json({ tags: tags.map(serialize) });
  } catch (err) {
    return respondError(err);
  }
}

export async function POST(req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    const body = await readJson(req);
    const tag = await createTag(prisma, user.id, params.id, body);
    return NextResponse.json(serialize(tag), { status: 201 });
  } catch (err) {
    return respondError(err);
  }
}
