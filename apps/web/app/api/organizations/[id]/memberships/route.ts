import { prisma } from "@notive/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { respondError } from "@/lib/http";
import { getCurrentSession } from "@/lib/session";
import { listMemberships } from "@/lib/services/membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: { id: string };
}

export async function GET(_req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    const memberships = await listMemberships(prisma, user.id, params.id);
    return NextResponse.json({
      memberships: memberships.map((m) => ({
        id: m.id,
        userId: m.userId,
        role: m.role,
        teamId: m.teamId,
        status: m.status,
        joinedAt: m.joinedAt,
      })),
    });
  } catch (err) {
    return respondError(err);
  }
}
