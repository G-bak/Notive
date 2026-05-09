import { prisma } from "@notive/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { readJson, respondError } from "@/lib/http";
import { getCurrentSession } from "@/lib/session";
import { updateTeam } from "@/lib/services/team";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: { id: string; teamId: string };
}

export async function PATCH(req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    const body = await readJson(req);
    const t = await updateTeam(prisma, user.id, params.id, params.teamId, body);
    return NextResponse.json({
      id: t.id,
      name: t.name,
      description: t.description,
      parentTeamId: t.parentTeamId,
      managerUserId: t.managerUserId,
      status: t.status,
    });
  } catch (err) {
    return respondError(err);
  }
}
