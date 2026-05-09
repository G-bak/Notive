import { login } from "@notive/auth";
import { prisma } from "@notive/db";
import { NextResponse } from "next/server";

import { Actions, findActiveOrganizationForUser, recordActivity } from "@/lib/audit";
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
    // Best-effort audit. Skipped for users without an active membership
    // (e.g. signed up but never accepted an invite) — Step 8 schema
    // requires organizationId, no migration in this step.
    const organizationId = await findActiveOrganizationForUser(prisma, session.userId);
    if (organizationId) {
      await recordActivity(prisma, {
        organizationId,
        actorUserId: session.userId,
        action: Actions.AUTH_LOGIN,
        targetType: "user",
        targetId: session.userId,
      });
    }
    return res;
  } catch (err) {
    return respondAuthError(err);
  }
}
