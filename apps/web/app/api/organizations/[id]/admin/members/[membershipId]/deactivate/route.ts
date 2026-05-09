// Admin alias for POST /organizations/{id}/memberships/{membershipId}/deactivate.
// Last-Admin protection still flows through @notive/permissions inside
// the Step 5 service.

import { prisma } from "@notive/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { respondError } from "@/lib/http";
import { getCurrentSession } from "@/lib/session";
import { deactivateMembership } from "@/lib/services/membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: { id: string; membershipId: string };
}

export async function POST(_req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    const m = await deactivateMembership(prisma, user.id, params.id, params.membershipId);
    return NextResponse.json({ id: m.id, status: m.status });
  } catch (err) {
    return respondError(err);
  }
}
