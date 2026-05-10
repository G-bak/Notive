// Phase C step 7-followup — route handler smoke tests.
//
// These tests exercise the actual Next.js route handlers (not just
// the underlying services) so the new strict query parsers and
// FORBIDDEN / NOT_FOUND envelope mapping cannot drift from the
// service-layer contract.
//
// Strategy:
//   - vi.mock("next/headers") so cookies() returns a stub jar
//     (the route calls cookies() but the result is forwarded to a
//     mocked getCurrentSession that ignores it).
//   - vi.mock("@/lib/session") so getCurrentSession returns a
//     pre-set { user, session } pair built around a real DB user.
//   - vi.hoisted is used to share mutable state with the mock
//     factory; vitest hoists vi.mock() above all imports, so a
//     closure-captured variable would still be in TDZ when the
//     factory runs.
//   - The DB is the embedded-postgres instance booted by the
//     integration global setup, so service code touches real rows.
//   - Each test sets the mocked user to the user it wants to act
//     as, builds a Request with the query string under test, and
//     awaits the handler directly.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { User } from "@notive/db";
import { prisma } from "@notive/db";

const hoisted = vi.hoisted(() => ({
  state: { user: null as { id: string; status: string } | null },
}));

// `next/headers` is redirected to a stub via the integration vitest
// config alias — see tests/integration/src/next-headers-stub.ts.

vi.mock("@/lib/session", () => ({
  getCurrentSession: async () => {
    if (hoisted.state.user === null) {
      const { AuthError } = await import("@notive/auth");
      throw new AuthError("UNAUTHORIZED", "no mock user");
    }
    return {
      user: hoisted.state.user,
      session: {
        id: "smoke-test-session",
        userId: hoisted.state.user.id,
        tokenHash: "n/a",
        expiresAt: new Date(Date.now() + 86_400_000),
        revokedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };
  },
}));

import { createDocument } from "../../apps/web/lib/services/document";
import { createTag } from "../../apps/web/lib/services/document-tag";
import * as docsRoute from "../../apps/web/app/api/organizations/[id]/documents/route";
import * as docByIdRoute from "../../apps/web/app/api/organizations/[id]/documents/[documentId]/route";
import * as tagsRoute from "../../apps/web/app/api/organizations/[id]/documents/tags/route";
import * as tagDeleteRoute from "../../apps/web/app/api/organizations/[id]/documents/tags/[tagId]/route";
import * as docTagsPutRoute from "../../apps/web/app/api/organizations/[id]/documents/[documentId]/tags/route";

import { createMembership, createOrganization, createTeam, createUser } from "./src/helpers.js";

interface Setup {
  orgId: string;
  teamA: string;
  admin: User;
  editor: User;
  editorB: User;
  manager: User;
  viewer: User;
  outsiderOrgId: string;
  outsider: User;
}

async function fetchUser(id: string): Promise<User> {
  const u = await prisma.user.findUnique({ where: { id } });
  if (!u) throw new Error(`user ${id} not found`);
  return u;
}

async function setup(): Promise<Setup> {
  const adminRow = await createUser("admin");
  const orgId = await createOrganization(adminRow.id, "smoke-org");
  await createMembership({
    userId: adminRow.id,
    organizationId: orgId,
    role: "Admin",
    status: "Active",
  });
  const teamA = await createTeam(orgId, "team-a");

  const editorRow = await createUser("editor");
  await createMembership({
    userId: editorRow.id,
    organizationId: orgId,
    teamId: teamA,
    role: "Editor",
    status: "Active",
  });
  const editorBRow = await createUser("editorB");
  await createMembership({
    userId: editorBRow.id,
    organizationId: orgId,
    teamId: teamA,
    role: "Editor",
    status: "Active",
  });
  const managerRow = await createUser("manager");
  await createMembership({
    userId: managerRow.id,
    organizationId: orgId,
    teamId: teamA,
    role: "Manager",
    status: "Active",
  });
  const viewerRow = await createUser("viewer");
  await createMembership({
    userId: viewerRow.id,
    organizationId: orgId,
    teamId: teamA,
    role: "Viewer",
    status: "Active",
  });

  const outsiderRow = await createUser("outsider");
  const outsiderOrgId = await createOrganization(outsiderRow.id, "smoke-outside");
  await createMembership({
    userId: outsiderRow.id,
    organizationId: outsiderOrgId,
    role: "Admin",
    status: "Active",
  });

  return {
    orgId,
    teamA,
    admin: await fetchUser(adminRow.id),
    editor: await fetchUser(editorRow.id),
    editorB: await fetchUser(editorBRow.id),
    manager: await fetchUser(managerRow.id),
    viewer: await fetchUser(viewerRow.id),
    outsiderOrgId,
    outsider: await fetchUser(outsiderRow.id),
  };
}

beforeEach(() => {
  hoisted.state.user = null;
});

interface Envelope {
  status: number;
  body: unknown;
}

async function call<P extends Record<string, string>>(
  handler: (req: Request, ctx: { params: P }) => Promise<Response>,
  url: string,
  params: P,
  init?: RequestInit,
): Promise<Envelope> {
  const req = new Request(url, init);
  const res = await handler(req, { params });
  if (res.status === 204) {
    return { status: 204, body: null };
  }
  const text = await res.text();
  return { status: res.status, body: text.length > 0 ? JSON.parse(text) : null };
}

// ---------------------------------------------------------------------
// documents GET — strict query parser
// ---------------------------------------------------------------------

describe("GET /organizations/[id]/documents", () => {
  it("happy path: returns 200 with documents envelope", async () => {
    const s = await setup();
    hoisted.state.user = s.editor;
    await createDocument(prisma, s.editor.id, s.orgId, {
      title: "smoke",
      documentType: "general",
      visibility: "Organization",
    });
    const r = await call(
      docsRoute.GET,
      `https://test.local/api/organizations/${s.orgId}/documents`,
      { id: s.orgId },
    );
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ documents: expect.any(Array) });
    expect((r.body as { documents: unknown[] }).documents.length).toBeGreaterThan(0);
  });

  it("invalid status -> 400 INVALID_INPUT envelope", async () => {
    const s = await setup();
    hoisted.state.user = s.editor;
    const r = await call(
      docsRoute.GET,
      `https://test.local/api/organizations/${s.orgId}/documents?status=Deleted`,
      { id: s.orgId },
    );
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: "INVALID_INPUT" });
  });

  it("invalid visibility -> 400", async () => {
    const s = await setup();
    hoisted.state.user = s.editor;
    const r = await call(
      docsRoute.GET,
      `https://test.local/api/organizations/${s.orgId}/documents?visibility=Department`,
      { id: s.orgId },
    );
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: "INVALID_INPUT" });
  });

  it("invalid limit (non-numeric) -> 400", async () => {
    const s = await setup();
    hoisted.state.user = s.editor;
    const r = await call(
      docsRoute.GET,
      `https://test.local/api/organizations/${s.orgId}/documents?limit=abc`,
      { id: s.orgId },
    );
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: "INVALID_INPUT" });
  });

  it("invalid UUID for tagId -> 400 (no Postgres uuid-parse 500 leak)", async () => {
    const s = await setup();
    hoisted.state.user = s.editor;
    const r = await call(
      docsRoute.GET,
      `https://test.local/api/organizations/${s.orgId}/documents?tagId=not-a-uuid`,
      { id: s.orgId },
    );
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: "INVALID_INPUT" });
  });
});

// ---------------------------------------------------------------------
// tags GET / POST / DELETE
// ---------------------------------------------------------------------

describe("tags routes", () => {
  it("GET /tags returns 200 with empty array initially", async () => {
    const s = await setup();
    hoisted.state.user = s.editor;
    const r = await call(
      tagsRoute.GET,
      `https://test.local/api/organizations/${s.orgId}/documents/tags`,
      { id: s.orgId },
    );
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ tags: [] });
  });

  it("POST /tags as Editor returns 201 with tag envelope", async () => {
    const s = await setup();
    hoisted.state.user = s.editor;
    const r = await call(
      tagsRoute.POST,
      `https://test.local/api/organizations/${s.orgId}/documents/tags`,
      { id: s.orgId },
      { method: "POST", body: JSON.stringify({ name: "x" }) },
    );
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ name: "x", organizationId: s.orgId });
  });

  it("POST /tags as Viewer returns 403 FORBIDDEN(tag_create_not_allowed)", async () => {
    const s = await setup();
    hoisted.state.user = s.viewer;
    const r = await call(
      tagsRoute.POST,
      `https://test.local/api/organizations/${s.orgId}/documents/tags`,
      { id: s.orgId },
      { method: "POST", body: JSON.stringify({ name: "x" }) },
    );
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({
      error: "FORBIDDEN",
      reason_code: "tag_create_not_allowed",
    });
  });

  it("DELETE /tags/[tagId] as Manager returns 204 with no body", async () => {
    const s = await setup();
    hoisted.state.user = s.editor;
    const tag = await createTag(prisma, s.editor.id, s.orgId, { name: "del-me" });
    hoisted.state.user = s.manager;
    const r = await call(
      tagDeleteRoute.DELETE,
      `https://test.local/api/organizations/${s.orgId}/documents/tags/${tag.id}`,
      { id: s.orgId, tagId: tag.id },
      { method: "DELETE" },
    );
    expect(r.status).toBe(204);
    expect(r.body).toBeNull();
  });

  it("DELETE /tags/[tagId] as Editor returns 403 FORBIDDEN(tag_delete_not_allowed)", async () => {
    const s = await setup();
    hoisted.state.user = s.editor;
    const tag = await createTag(prisma, s.editor.id, s.orgId, { name: "guarded" });
    const r = await call(
      tagDeleteRoute.DELETE,
      `https://test.local/api/organizations/${s.orgId}/documents/tags/${tag.id}`,
      { id: s.orgId, tagId: tag.id },
      { method: "DELETE" },
    );
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({
      error: "FORBIDDEN",
      reason_code: "tag_delete_not_allowed",
    });
  });

  it("DELETE /tags/[tagId] cross-org returns 404 NOT_FOUND with no reason_code", async () => {
    const s = await setup();
    hoisted.state.user = s.editor;
    const tag = await createTag(prisma, s.editor.id, s.orgId, { name: "outsider-cant-delete" });
    hoisted.state.user = s.outsider;
    const r = await call(
      tagDeleteRoute.DELETE,
      `https://test.local/api/organizations/${s.outsiderOrgId}/documents/tags/${tag.id}`,
      { id: s.outsiderOrgId, tagId: tag.id },
      { method: "DELETE" },
    );
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: "NOT_FOUND" }); // no reason_code
  });
});

// ---------------------------------------------------------------------
// documents/[documentId]/tags PUT
// ---------------------------------------------------------------------

describe("PUT /documents/[documentId]/tags", () => {
  it("Owner with Edit returns 200 and the tag list", async () => {
    const s = await setup();
    hoisted.state.user = s.editor;
    const tag = await createTag(prisma, s.editor.id, s.orgId, { name: "k" });
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "x",
      documentType: "general",
    });
    const r = await call(
      docTagsPutRoute.PUT,
      `https://test.local/api/organizations/${s.orgId}/documents/${doc.id}/tags`,
      { id: s.orgId, documentId: doc.id },
      { method: "PUT", body: JSON.stringify({ tagIds: [tag.id] }) },
    );
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      tags: expect.arrayContaining([expect.objectContaining({ id: tag.id })]),
      diff: { added: 1, removed: 0, total: 1 },
    });
  });

  it("View-only viewer returns 403 FORBIDDEN(document_edit_not_allowed)", async () => {
    const s = await setup();
    hoisted.state.user = s.editor;
    const tag = await createTag(prisma, s.editor.id, s.orgId, { name: "k" });
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "shared",
      documentType: "general",
      visibility: "Organization",
    });
    hoisted.state.user = s.editorB; // org-public -> View only
    const r = await call(
      docTagsPutRoute.PUT,
      `https://test.local/api/organizations/${s.orgId}/documents/${doc.id}/tags`,
      { id: s.orgId, documentId: doc.id },
      { method: "PUT", body: JSON.stringify({ tagIds: [tag.id] }) },
    );
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({
      error: "FORBIDDEN",
      reason_code: "document_edit_not_allowed",
    });
  });

  it("no-view actor returns 404 NOT_FOUND (no reason_code)", async () => {
    const s = await setup();
    hoisted.state.user = s.editor;
    const tag = await createTag(prisma, s.editor.id, s.orgId, { name: "k" });
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "private",
      documentType: "general",
      visibility: "Private",
    });
    hoisted.state.user = s.editorB;
    const r = await call(
      docTagsPutRoute.PUT,
      `https://test.local/api/organizations/${s.orgId}/documents/${doc.id}/tags`,
      { id: s.orgId, documentId: doc.id },
      { method: "PUT", body: JSON.stringify({ tagIds: [tag.id] }) },
    );
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: "NOT_FOUND" });
  });
});

// ---------------------------------------------------------------------
// documents core routes — Phase C step 8
//   POST   /organizations/[id]/documents
//   GET    /organizations/[id]/documents/[documentId]
//   PATCH  /organizations/[id]/documents/[documentId]
//   DELETE /organizations/[id]/documents/[documentId]
//
// Smoke matrix (Codex Phase C step 8 directive):
//   - happy path 200 / 201
//   - Viewer create 403
//   - no-view detail 404 (envelope must have NO reason_code)
//   - view-only patch / delete 403
// ---------------------------------------------------------------------

describe("POST /organizations/[id]/documents", () => {
  it("happy path: Editor returns 201 with document envelope", async () => {
    const s = await setup();
    hoisted.state.user = s.editor;
    const r = await call(
      docsRoute.POST,
      `https://test.local/api/organizations/${s.orgId}/documents`,
      { id: s.orgId },
      {
        method: "POST",
        body: JSON.stringify({
          title: "smoke-create",
          documentType: "general",
          visibility: "Private",
        }),
      },
    );
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      organizationId: s.orgId,
      title: "smoke-create",
      ownerUserId: s.editor.id,
      status: "Draft",
      visibility: "Private",
    });
  });

  it("Viewer returns 403 FORBIDDEN(document_create_not_allowed)", async () => {
    const s = await setup();
    hoisted.state.user = s.viewer;
    const r = await call(
      docsRoute.POST,
      `https://test.local/api/organizations/${s.orgId}/documents`,
      { id: s.orgId },
      {
        method: "POST",
        body: JSON.stringify({
          title: "viewer-blocked",
          documentType: "general",
        }),
      },
    );
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({
      error: "FORBIDDEN",
      reason_code: "document_create_not_allowed",
    });
  });
});

describe("GET /organizations/[id]/documents/[documentId]", () => {
  it("happy path: owner Editor returns 200 with document + permission", async () => {
    const s = await setup();
    hoisted.state.user = s.editor;
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "owner-view",
      documentType: "general",
      visibility: "Private",
    });
    const r = await call(
      docByIdRoute.GET,
      `https://test.local/api/organizations/${s.orgId}/documents/${doc.id}`,
      { id: s.orgId, documentId: doc.id },
    );
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      id: doc.id,
      ownerUserId: s.editor.id,
      permission: "Manage",
    });
  });

  it("no-view actor returns 404 NOT_FOUND envelope without reason_code", async () => {
    const s = await setup();
    hoisted.state.user = s.editor;
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "private-detail",
      documentType: "general",
      visibility: "Private",
    });
    hoisted.state.user = s.editorB;
    const r = await call(
      docByIdRoute.GET,
      `https://test.local/api/organizations/${s.orgId}/documents/${doc.id}`,
      { id: s.orgId, documentId: doc.id },
    );
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: "NOT_FOUND" }); // no reason_code
  });

  it("cross-org actor returns 404 NOT_FOUND envelope without reason_code", async () => {
    const s = await setup();
    hoisted.state.user = s.editor;
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "cross-org-detail",
      documentType: "general",
      visibility: "Organization",
    });
    hoisted.state.user = s.outsider;
    const r = await call(
      docByIdRoute.GET,
      `https://test.local/api/organizations/${s.outsiderOrgId}/documents/${doc.id}`,
      { id: s.outsiderOrgId, documentId: doc.id },
    );
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: "NOT_FOUND" });
  });
});

describe("PATCH /organizations/[id]/documents/[documentId]", () => {
  it("happy path: owner Editor returns 200 with updated title", async () => {
    const s = await setup();
    hoisted.state.user = s.editor;
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "patch-me",
      documentType: "general",
      visibility: "Private",
    });
    const r = await call(
      docByIdRoute.PATCH,
      `https://test.local/api/organizations/${s.orgId}/documents/${doc.id}`,
      { id: s.orgId, documentId: doc.id },
      { method: "PATCH", body: JSON.stringify({ title: "patched-title" }) },
    );
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: doc.id, title: "patched-title" });
  });

  it("view-only actor returns 403 FORBIDDEN(document_edit_not_allowed)", async () => {
    const s = await setup();
    hoisted.state.user = s.editor;
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "org-shared",
      documentType: "general",
      visibility: "Organization",
    });
    hoisted.state.user = s.editorB; // org-public => View only on someone else's doc
    const r = await call(
      docByIdRoute.PATCH,
      `https://test.local/api/organizations/${s.orgId}/documents/${doc.id}`,
      { id: s.orgId, documentId: doc.id },
      { method: "PATCH", body: JSON.stringify({ title: "hijacked" }) },
    );
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({
      error: "FORBIDDEN",
      reason_code: "document_edit_not_allowed",
    });
  });
});

describe("DELETE /organizations/[id]/documents/[documentId]", () => {
  it("happy path: owner Editor returns 200 with soft-deleted envelope", async () => {
    const s = await setup();
    hoisted.state.user = s.editor;
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "delete-me",
      documentType: "general",
      visibility: "Private",
    });
    const r = await call(
      docByIdRoute.DELETE,
      `https://test.local/api/organizations/${s.orgId}/documents/${doc.id}`,
      { id: s.orgId, documentId: doc.id },
      { method: "DELETE" },
    );
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: doc.id, status: "Deleted" });
    expect((r.body as { deletedAt: string | null }).deletedAt).not.toBeNull();
  });

  it("view-only actor returns 403 FORBIDDEN(document_manage_not_allowed)", async () => {
    const s = await setup();
    hoisted.state.user = s.editor;
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "delete-guarded",
      documentType: "general",
      visibility: "Organization",
    });
    hoisted.state.user = s.editorB; // View only via org visibility
    const r = await call(
      docByIdRoute.DELETE,
      `https://test.local/api/organizations/${s.orgId}/documents/${doc.id}`,
      { id: s.orgId, documentId: doc.id },
      { method: "DELETE" },
    );
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({
      error: "FORBIDDEN",
      reason_code: "document_manage_not_allowed",
    });
  });

  it("no-view actor returns 404 NOT_FOUND envelope without reason_code", async () => {
    const s = await setup();
    hoisted.state.user = s.editor;
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "delete-private",
      documentType: "general",
      visibility: "Private",
    });
    hoisted.state.user = s.editorB;
    const r = await call(
      docByIdRoute.DELETE,
      `https://test.local/api/organizations/${s.orgId}/documents/${doc.id}`,
      { id: s.orgId, documentId: doc.id },
      { method: "DELETE" },
    );
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: "NOT_FOUND" });
  });
});
