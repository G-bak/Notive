import { prisma } from "@notive/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { respondError } from "@/lib/http";
import { getCurrentSession } from "@/lib/session";
import { deleteTag } from "@/lib/services/document-tag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: { id: string; tagId: string };
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    await deleteTag(prisma, user.id, params.id, params.tagId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return respondError(err);
  }
}
