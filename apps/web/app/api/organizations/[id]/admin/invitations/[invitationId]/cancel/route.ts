// Admin alias for POST /organizations/{id}/invitations/{invitationId}/cancel.

import { prisma } from "@notive/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { respondError } from "@/lib/http";
import { getCurrentSession } from "@/lib/session";
import { cancelInvitation } from "@/lib/services/invitation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: { id: string; invitationId: string };
}

export async function POST(_req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    const i = await cancelInvitation(prisma, user.id, params.id, params.invitationId);
    return NextResponse.json({ id: i.id, status: i.status });
  } catch (err) {
    return respondError(err);
  }
}
