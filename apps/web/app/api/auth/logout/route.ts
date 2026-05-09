import { logout } from "@notive/auth";
import { prisma } from "@notive/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { SESSION_COOKIE, clearSessionCookie } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  await logout(prisma, token);
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res.cookies);
  return res;
}
