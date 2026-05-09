import { prisma } from "@notive/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { respondError } from "@/lib/http";
import { getCurrentSession } from "@/lib/session";
import { listActivityLogs } from "@/lib/services/activity-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: { id: string };
}

export async function GET(req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    const url = new URL(req.url);
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam !== null ? Number(limitParam) : undefined;
    const entries = await listActivityLogs(prisma, user.id, params.id, { limit });
    return NextResponse.json({ entries });
  } catch (err) {
    return respondError(err);
  }
}
