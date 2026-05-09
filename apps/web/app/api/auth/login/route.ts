import { login } from "@notive/auth";
import { prisma } from "@notive/db";
import { NextResponse } from "next/server";

import { readJson, respondAuthError } from "@/lib/http";
import { sessionTtl, setSessionCookie } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const { token, session } = await login(prisma, body, { ttl: sessionTtl() });
    const res = NextResponse.json({ ok: true });
    setSessionCookie(res.cookies, token, session.expiresAt);
    return res;
  } catch (err) {
    return respondAuthError(err);
  }
}
