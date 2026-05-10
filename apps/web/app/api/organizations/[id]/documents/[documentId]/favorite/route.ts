import { prisma } from "@notive/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { respondError } from "@/lib/http";
import { getCurrentSession } from "@/lib/session";
import { setFavorite, unsetFavorite } from "@/lib/services/document-favorite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: { id: string; documentId: string };
}

export async function PUT(_req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    const fav = await setFavorite(prisma, user.id, params.id, params.documentId);
    return NextResponse.json({
      id: fav.id,
      userId: fav.userId,
      organizationId: fav.organizationId,
      documentId: fav.documentId,
      createdAt: fav.createdAt.toISOString(),
    });
  } catch (err) {
    return respondError(err);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    await unsetFavorite(prisma, user.id, params.id, params.documentId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return respondError(err);
  }
}
