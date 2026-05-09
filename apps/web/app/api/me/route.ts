import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { respondAuthError } from "@/lib/http";
import { getCurrentSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { user } = await getCurrentSession(cookies());
    return NextResponse.json({
      id: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt,
    });
  } catch (err) {
    return respondAuthError(err);
  }
}
