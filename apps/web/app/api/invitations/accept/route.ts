import { prisma } from "@notive/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { readJson, respondError } from "@/lib/http";
import { getCurrentSession } from "@/lib/session";
import { acceptInvitation } from "@/lib/services/invitation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { user } = await getCurrentSession(cookies());
    const body = await readJson(req);
    const { membership, invitation } = await acceptInvitation(prisma, user, body);
    return NextResponse.json({
      membershipId: membership.id,
      organizationId: membership.organizationId,
      role: membership.role,
      invitationId: invitation.id,
      invitationStatus: invitation.status,
    });
  } catch (err) {
    return respondError(err);
  }
}
