// Admin aliases for /organizations/{id}/invitations.
//
// Reuses the Step 5 invitation service unchanged. Manager creating an
// invitation here still trips manager_cannot_invite via
// @notive/permissions inside the service.

import { prisma } from "@notive/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getEnv } from "@/lib/env";
import { readJson, respondError } from "@/lib/http";
import { getMailAdapter } from "@/lib/mail";
import { getCurrentSession } from "@/lib/session";
import { createInvitation, listInvitations } from "@/lib/services/invitation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: { id: string };
}

export async function GET(_req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    const invitations = await listInvitations(prisma, user.id, params.id);
    return NextResponse.json({
      invitations: invitations.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        teamId: i.teamId,
        status: i.status,
        expiresAt: i.expiresAt,
        createdAt: i.createdAt,
      })),
    });
  } catch (err) {
    return respondError(err);
  }
}

export async function POST(req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    const body = await readJson(req);
    const env = getEnv();
    const { invitation } = await createInvitation(
      prisma,
      getMailAdapter(),
      { id: user.id, name: user.name },
      params.id,
      body,
      { appBaseUrl: env.APP_BASE_URL, ttlDays: env.MAIL_INVITE_TTL_DAYS },
    );
    return NextResponse.json(
      {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        teamId: invitation.teamId,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
      },
      { status: 201 },
    );
  } catch (err) {
    return respondError(err);
  }
}
