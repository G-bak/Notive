import { prisma } from "@notive/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { respondError } from "@/lib/http";
import { getCurrentSession } from "@/lib/session";
import { archiveTeam } from "@/lib/services/team";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: { id: string; teamId: string };
}

export async function POST(_req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    const t = await archiveTeam(prisma, user.id, params.id, params.teamId);
    return NextResponse.json({ id: t.id, status: t.status });
  } catch (err) {
    return respondError(err);
  }
}
