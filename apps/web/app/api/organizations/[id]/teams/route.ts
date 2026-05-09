import { prisma } from "@notive/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { readJson, respondError } from "@/lib/http";
import { getCurrentSession } from "@/lib/session";
import { createTeam, listTeams } from "@/lib/services/team";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: { id: string };
}

export async function GET(_req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    const teams = await listTeams(prisma, user.id, params.id);
    return NextResponse.json({
      teams: teams.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        parentTeamId: t.parentTeamId,
        managerUserId: t.managerUserId,
        status: t.status,
      })),
    });
  } catch (err) {
    return respondError(err);
  }
}

export async function POST(req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    const body = await readJson(req);
    const t = await createTeam(prisma, user.id, params.id, body);
    return NextResponse.json(
      {
        id: t.id,
        name: t.name,
        description: t.description,
        parentTeamId: t.parentTeamId,
        managerUserId: t.managerUserId,
        status: t.status,
      },
      { status: 201 },
    );
  } catch (err) {
    return respondError(err);
  }
}
