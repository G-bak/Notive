import { resendVerification } from "@notive/auth";
import { prisma } from "@notive/db";
import { NextResponse } from "next/server";

import { getEnv } from "@/lib/env";
import { readJson, respondAuthError } from "@/lib/http";
import { getMailAdapter } from "@/lib/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const env = getEnv();
    await resendVerification(prisma, getMailAdapter(), body, {
      appBaseUrl: env.APP_BASE_URL,
      verifyTtlHours: env.MAIL_VERIFY_TTL_HOURS,
    });
    // Always 202 — no enumeration.
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (err) {
    return respondAuthError(err);
  }
}
