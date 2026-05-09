import { hashToken, logout } from "@notive/auth";
import { prisma } from "@notive/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { Actions, findActiveOrganizationForUser, recordActivity } from "@/lib/audit";
import { SESSION_COOKIE, clearSessionCookie } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  // Resolve the actor BEFORE revoking the session.
  let actorUserId: string | null = null;
  if (token) {
    const sess = await prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { userId: true, revokedAt: true },
    });
    if (sess && !sess.revokedAt) {
      actorUserId = sess.userId;
    }
  }
  await logout(prisma, token);
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res.cookies);
  if (actorUserId) {
    const organizationId = await findActiveOrganizationForUser(prisma, actorUserId);
    if (organizationId) {
      await recordActivity(prisma, {
        organizationId,
        actorUserId,
        action: Actions.AUTH_LOGOUT,
        targetType: "user",
        targetId: actorUserId,
      });
    }
  }
  return res;
}
