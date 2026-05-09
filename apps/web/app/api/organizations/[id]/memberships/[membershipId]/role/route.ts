import { prisma } from "@notive/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { readJson, respondError } from "@/lib/http";
import { getCurrentSession } from "@/lib/session";
import { changeRole } from "@/lib/services/membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: { id: string; membershipId: string };
}

export async function PATCH(req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    const body = await readJson(req);
    const m = await changeRole(prisma, user.id, params.id, params.membershipId, body);
    return NextResponse.json({ id: m.id, role: m.role, status: m.status });
  } catch (err) {
    return respondError(err);
  }
}
