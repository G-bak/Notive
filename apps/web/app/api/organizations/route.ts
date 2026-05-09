import { prisma } from "@notive/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { readJson, respondError } from "@/lib/http";
import { getCurrentSession } from "@/lib/session";
import { createOrganization } from "@/lib/services/organization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { user } = await getCurrentSession(cookies());
    const body = await readJson(req);
    const org = await createOrganization(prisma, user, body);
    return NextResponse.json(
      { id: org.id, name: org.name, slug: org.slug, status: org.status },
      { status: 201 },
    );
  } catch (err) {
    return respondError(err);
  }
}
