// Admin alias for PATCH /organizations/{id}/memberships/{membershipId}/role.
//
// Phase B step 7: same handler logic as the Step 5 route — the Step 5
// service already enforces requireAdmin / last-Admin protection through
// @notive/permissions. We expose this under /admin/* so the future
// admin UI can reach it via a stable namespace, but we do not duplicate
// any validation here.

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
