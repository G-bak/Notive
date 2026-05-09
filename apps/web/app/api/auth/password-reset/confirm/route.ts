import { confirmPasswordReset } from "@notive/auth";
import { prisma } from "@notive/db";
import { NextResponse } from "next/server";

import { readJson, respondAuthError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    await confirmPasswordReset(prisma, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return respondAuthError(err);
  }
}
