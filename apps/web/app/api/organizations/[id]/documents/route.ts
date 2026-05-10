import { prisma } from "@notive/db";
import { Errors } from "@notive/permissions";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { readJson, respondError } from "@/lib/http";
import { getCurrentSession } from "@/lib/session";
import { createDocument, listDocuments, type ListDocumentsOptions } from "@/lib/services/document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: { id: string };
}

function serialize(d: Awaited<ReturnType<typeof createDocument>>) {
  return {
    id: d.id,
    organizationId: d.organizationId,
    title: d.title,
    content: d.content,
    documentType: d.documentType,
    status: d.status,
    ownerUserId: d.ownerUserId,
    authorUserId: d.authorUserId,
    ownerTeamId: d.ownerTeamId,
    visibility: d.visibility,
    sourceType: d.sourceType,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

// Strict query-string parsers: invalid values throw INVALID_INPUT
// rather than being silently dropped. Phase C step 7 / Codex review:
// "status=Deleted" or "limit=abc" should not return the default list,
// because that hides a client bug behind a successful response.

function parseStatus(s: string | null): ListDocumentsOptions["status"] | undefined {
  if (s === null) return undefined;
  if (s === "Draft" || s === "Active" || s === "Archived") return s;
  throw Errors.invalid(`invalid status: ${s}`);
}

function parseVisibility(s: string | null): ListDocumentsOptions["visibility"] | undefined {
  if (s === null) return undefined;
  if (s === "Private" || s === "Team" || s === "Organization" || s === "SpecificUsers") return s;
  throw Errors.invalid(`invalid visibility: ${s}`);
}

function parseFavorite(s: string | null): boolean | undefined {
  if (s === null) return undefined;
  if (s === "true") return true;
  if (s === "false") return false;
  throw Errors.invalid(`invalid favorite: ${s}`);
}

function parseLimit(s: string | null): number | undefined {
  if (s === null) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n)) {
    throw Errors.invalid(`invalid limit: ${s}`);
  }
  return n;
}

// Strict UUID parser for query params that map to Postgres uuid
// columns (ownerTeamId, authorUserId, tagId). Without this, a junk
// value like "?tagId=abc" reaches Prisma's where clause and Postgres
// raises a uuid-parse error that surfaces as INTERNAL_ERROR. The
// pattern matches Prisma's own UUID validation.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseUuid(s: string | null, field: string): string | undefined {
  if (s === null) return undefined;
  if (!UUID_RE.test(s)) {
    throw Errors.invalid(`invalid ${field}: ${s}`);
  }
  return s;
}

export async function GET(req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    const url = new URL(req.url);
    const sp = url.searchParams;
    const opts: ListDocumentsOptions = {};
    const status = parseStatus(sp.get("status"));
    if (status !== undefined) opts.status = status;
    const visibility = parseVisibility(sp.get("visibility"));
    if (visibility !== undefined) opts.visibility = visibility;
    const documentType = sp.get("documentType");
    if (documentType !== null) opts.documentType = documentType;
    const ownerTeamId = parseUuid(sp.get("ownerTeamId"), "ownerTeamId");
    if (ownerTeamId !== undefined) opts.ownerTeamId = ownerTeamId;
    const authorUserId = parseUuid(sp.get("authorUserId"), "authorUserId");
    if (authorUserId !== undefined) opts.authorUserId = authorUserId;
    const tagId = parseUuid(sp.get("tagId"), "tagId");
    if (tagId !== undefined) opts.tagId = tagId;
    const q = sp.get("q");
    if (q !== null) opts.q = q;
    const favorite = parseFavorite(sp.get("favorite"));
    if (favorite === true) opts.favorite = true;
    const limit = parseLimit(sp.get("limit"));
    if (limit !== undefined) opts.limit = limit;
    const docs = await listDocuments(prisma, user.id, params.id, opts);
    return NextResponse.json({ documents: docs.map(serialize) });
  } catch (err) {
    return respondError(err);
  }
}

export async function POST(req: Request, { params }: Params) {
  try {
    const { user } = await getCurrentSession(cookies());
    const body = await readJson(req);
    const doc = await createDocument(prisma, user.id, params.id, body);
    return NextResponse.json(serialize(doc), { status: 201 });
  } catch (err) {
    return respondError(err);
  }
}
