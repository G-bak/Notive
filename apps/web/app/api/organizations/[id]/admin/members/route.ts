import { prisma } from "@notive/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { respondError } from "@/lib/http";
import { getCurrentSession } from "@/lib/session";
import { listAdminMembers } from "@/lib/services/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: { id: string };
}

export async function GET(_req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    const members = await listAdminMembers(prisma, user.id, params.id);
    return NextResponse.json({ members });
  } catch (err) {
    return respondError(err);
  }
}
