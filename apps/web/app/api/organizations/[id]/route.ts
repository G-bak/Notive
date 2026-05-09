import { prisma } from "@notive/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { readJson, respondError } from "@/lib/http";
import { getCurrentSession } from "@/lib/session";
import { getOrganization, updateOrganization } from "@/lib/services/organization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: { id: string };
}

export async function GET(_req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    const org = await getOrganization(prisma, user.id, params.id);
    return NextResponse.json({
      id: org.id,
      name: org.name,
      slug: org.slug,
      status: org.status,
    });
  } catch (err) {
    return respondError(err);
  }
}

export async function PATCH(req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    const body = await readJson(req);
    const org = await updateOrganization(prisma, user.id, params.id, body);
    return NextResponse.json({
      id: org.id,
      name: org.name,
      slug: org.slug,
      status: org.status,
    });
  } catch (err) {
    return respondError(err);
  }
}
