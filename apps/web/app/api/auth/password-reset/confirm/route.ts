import { confirmPasswordReset } from "@notive/auth";
import { prisma } from "@notive/db";
import { NextResponse } from "next/server";

import { Actions, findActiveOrganizationForUser, recordActivity } from "@/lib/audit";
import { readJson, respondAuthError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const { userId } = await confirmPasswordReset(prisma, body);
    const organizationId = await findActiveOrganizationForUser(prisma, userId);
    if (organizationId) {
      await recordActivity(prisma, {
        organizationId,
        actorUserId: userId,
        action: Actions.AUTH_PASSWORD_RESET_COMPLETED,
        targetType: "user",
        targetId: userId,
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return respondAuthError(err);
  }
}
