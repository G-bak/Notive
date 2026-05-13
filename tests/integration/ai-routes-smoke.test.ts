// Phase D step 4 - AI route smoke tests.
//
// Pins the route-level boundary on top of the Step 2/3 services:
//
//   - POST   /api/organizations/[id]/ai/generate
//   - GET    /api/organizations/[id]/ai/requests/[aiRequestId]/preview
//   - DELETE /api/organizations/[id]/ai/requests/[aiRequestId]/preview
//
// Most important invariant: the route NEVER reads `userId` from the
// client. Session user is the only actor source. A client-supplied
// `userId` in the request body is ignored. These tests pin that
// by sending an outsider's userId in the body and asserting the
// response carries the session user instead.
//
// Strategy follows the documents smoke pattern:
//   - vi.mock("@/lib/session") swaps in a hoisted user.
//   - The route ultimately calls `generateAiDocument`, which uses
//     the default mock provider + default preview store singletons.
//     For the "provider failure" case we additionally mock the
//     provider factory module so the toggled `forceProviderFailure`
//     state takes effect for the next call.
//   - Real DB through the integration embedded-postgres setup.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { User } from "@notive/db";
import { prisma } from "@notive/db";

const hoisted = vi.hoisted(() => ({
  state: {
    user: null as { id: string; status: string } | null,
    forceProviderFailure: null as string | null,
  },
}));

vi.mock("@/lib/session", () => ({
  getCurrentSession: async () => {
    if (hoisted.state.user === null) {
      const { AuthError } = await import("@notive/auth");
      throw new AuthError("UNAUTHORIZED", "no mock user");
    }
    return {
      user: hoisted.state.user,
      session: {
        id: "ai-smoke-session",
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

// Wrap the mock provider factory so a test can flip
// `forceProviderFailure` before invoking the route, without the
// route itself accepting any provider-injection hook (which would
// be a production-surface leak).
vi.mock("../../apps/web/lib/ai/provider/mock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../apps/web/lib/ai/provider/mock")>();
  return {
    ...actual,
    createMockAiProvider: (opts: { forceFailure?: string } = {}) => {
      const forced = hoisted.state.forceProviderFailure ?? opts.forceFailure;
      return actual.createMockAiProvider(forced ? { forceFailure: forced } : opts);
    },
  };
});

import { createDocument } from "../../apps/web/lib/services/document";
import * as generateRoute from "../../apps/web/app/api/organizations/[id]/ai/generate/route";
import * as previewRoute from "../../apps/web/app/api/organizations/[id]/ai/requests/[aiRequestId]/preview/route";

import { createMembership, createOrganization, createUser } from "./src/helpers.js";

interface Setup {
  orgId: string;
  admin: User;
  editor: User;
  editorB: User;
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
  const orgId = await createOrganization(adminRow.id, "ai-route-org");
  await createMembership({
    userId: adminRow.id,
    organizationId: orgId,
    role: "Admin",
    status: "Active",
  });

  const editorRow = await createUser("editor");
  await createMembership({
    userId: editorRow.id,
    organizationId: orgId,
    role: "Editor",
    status: "Active",
  });
  const editorBRow = await createUser("editorB");
  await createMembership({
    userId: editorBRow.id,
    organizationId: orgId,
    role: "Editor",
    status: "Active",
  });
  const viewerRow = await createUser("viewer");
  await createMembership({
    userId: viewerRow.id,
    organizationId: orgId,
    role: "Viewer",
    status: "Active",
  });

  const outsiderRow = await createUser("outsider");
  const outsiderOrgId = await createOrganization(outsiderRow.id, "ai-route-outside");
  await createMembership({
    userId: outsiderRow.id,
    organizationId: outsiderOrgId,
    role: "Admin",
    status: "Active",
  });

  return {
    orgId,
    admin: await fetchUser(adminRow.id),
    editor: await fetchUser(editorRow.id),
    editorB: await fetchUser(editorBRow.id),
    viewer: await fetchUser(viewerRow.id),
    outsiderOrgId,
    outsider: await fetchUser(outsiderRow.id),
  };
}

beforeEach(() => {
  hoisted.state.user = null;
  hoisted.state.forceProviderFailure = null;
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
// POST /organizations/[id]/ai/generate
// ---------------------------------------------------------------------

describe("POST /organizations/[id]/ai/generate", () => {
  it("unauthenticated returns 401 UNAUTHORIZED envelope", async () => {
    const s = await setup();
    // hoisted.state.user left null on purpose.
    const r = await call(
      generateRoute.POST,
      `https://test.local/api/organizations/${s.orgId}/ai/generate`,
      { id: s.orgId },
      {
        method: "POST",
        body: JSON.stringify({ documentType: "general" }),
      },
    );
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({
      error: "UNAUTHORIZED",
      reason_code: "UNAUTHORIZED",
    });
  });

  it("Editor happy path: returns 201 with aiRequest/aiResult/preview envelope", async () => {
    const s = await setup();
    hoisted.state.user = s.editor;
    const r = await call(
      generateRoute.POST,
      `https://test.local/api/organizations/${s.orgId}/ai/generate`,
      { id: s.orgId },
      {
        method: "POST",
        body: JSON.stringify({
          documentType: "weekly-report",
          purpose: "summary",
          audience: "team",
          tone: "concise",
        }),
      },
    );
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      aiRequest: {
        organizationId: s.orgId,
        requestedByUserId: s.editor.id,
        status: "Completed",
        documentType: "weekly-report",
        purpose: "summary",
      },
      aiResult: { status: "Generated", errorCode: null },
      references: [],
      preview: {
        title: expect.stringContaining("weekly-report"),
        content: expect.any(String),
        expiresAt: expect.any(String),
      },
    });
    const body = r.body as {
      aiRequest: { id: string };
      preview: { aiRequestId: string };
    };
    expect(body.preview.aiRequestId).toBe(body.aiRequest.id);
  });

  it("Viewer returns 403 FORBIDDEN(ai_request_create_not_allowed)", async () => {
    const s = await setup();
    hoisted.state.user = s.viewer;
    const r = await call(
      generateRoute.POST,
      `https://test.local/api/organizations/${s.orgId}/ai/generate`,
      { id: s.orgId },
      {
        method: "POST",
        body: JSON.stringify({ documentType: "general" }),
      },
    );
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({
      error: "FORBIDDEN",
      reason_code: "ai_request_create_not_allowed",
    });
    const aiRowCount = await prisma.aiRequest.count({
      where: { organizationId: s.orgId, requestedByUserId: s.viewer.id },
    });
    expect(aiRowCount).toBe(0);
  });

  it("route ignores client-supplied userId and uses session user as actor", async () => {
    const s = await setup();
    hoisted.state.user = s.editor;
    // Client tries to spoof the actor by sending a different userId
    // in the body. The route must not read it.
    const r = await call(
      generateRoute.POST,
      `https://test.local/api/organizations/${s.orgId}/ai/generate`,
      { id: s.orgId },
      {
        method: "POST",
        body: JSON.stringify({
          documentType: "general",
          userId: s.outsider.id, // ignored
        }),
      },
    );
    expect(r.status).toBe(201);
    const body = r.body as { aiRequest: { id: string; requestedByUserId: string } };
    expect(body.aiRequest.requestedByUserId).toBe(s.editor.id);

    // The persisted row also belongs to the session user, not the
    // body-supplied id.
    const row = await prisma.aiRequest.findUniqueOrThrow({
      where: { id: body.aiRequest.id },
    });
    expect(row.requestedByUserId).toBe(s.editor.id);
    expect(row.requestedByUserId).not.toBe(s.outsider.id);
  });

  it("cross-org actor returns 404 NOT_FOUND envelope without reason_code", async () => {
    const s = await setup();
    hoisted.state.user = s.outsider;
    const r = await call(
      generateRoute.POST,
      `https://test.local/api/organizations/${s.orgId}/ai/generate`,
      { id: s.orgId },
      {
        method: "POST",
        body: JSON.stringify({ documentType: "general" }),
      },
    );
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: "NOT_FOUND" });
  });

  it("provider failure: returns 201 with preview=null and no stored preview", async () => {
    const s = await setup();
    hoisted.state.user = s.editor;
    hoisted.state.forceProviderFailure = "provider_timeout";

    const r = await call(
      generateRoute.POST,
      `https://test.local/api/organizations/${s.orgId}/ai/generate`,
      { id: s.orgId },
      {
        method: "POST",
        body: JSON.stringify({ documentType: "general" }),
      },
    );
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      aiRequest: { status: "Failed", errorCode: "provider_timeout" },
      aiResult: { status: "Failed", errorCode: "provider_timeout" },
      preview: null,
    });
    const body = r.body as { aiRequest: { id: string } };

    // Subsequent preview load on the failed request returns NOT_FOUND
    // Confirms no preview was stored.
    const get = await call(
      previewRoute.GET,
      `https://test.local/api/organizations/${s.orgId}/ai/requests/${body.aiRequest.id}/preview`,
      { id: s.orgId, aiRequestId: body.aiRequest.id },
    );
    expect(get.status).toBe(404);
    expect(get.body).toEqual({ error: "NOT_FOUND" });
  });

  it("blocked cross-org reference: completes but title does not leak into preview", async () => {
    const s = await setup();
    // Outsider authors a Private document in their own org. Editor
    // tries to use it as a reference; service must drop it before
    // the provider call.
    hoisted.state.user = s.outsider;
    const outsiderDoc = await createDocument(prisma, s.outsider.id, s.outsiderOrgId, {
      title: "foreign-secret-title",
      documentType: "general",
      visibility: "Private",
    });

    hoisted.state.user = s.editor;
    const r = await call(
      generateRoute.POST,
      `https://test.local/api/organizations/${s.orgId}/ai/generate`,
      { id: s.orgId },
      {
        method: "POST",
        body: JSON.stringify({
          documentType: "general",
          referenceDocumentIds: [outsiderDoc.id],
        }),
      },
    );
    expect(r.status).toBe(201);
    const body = r.body as {
      aiRequest: { status: string };
      references: Array<{ targetId: string; targetTitle: string | null; accessAllowed: boolean }>;
      preview: { title: string; content: string };
    };
    expect(body.aiRequest.status).toBe("Completed");
    expect(body.references).toHaveLength(1);
    expect(body.references[0]).toMatchObject({
      targetId: outsiderDoc.id,
      targetTitle: null,
      accessAllowed: false,
    });
    expect(body.preview.title).not.toContain("foreign-secret-title");
    expect(body.preview.content).not.toContain("foreign-secret-title");
  });
});

// ---------------------------------------------------------------------
// GET /organizations/[id]/ai/requests/[aiRequestId]/preview
// ---------------------------------------------------------------------

describe("GET /organizations/[id]/ai/requests/[aiRequestId]/preview", () => {
  async function generateAs(orgId: string, user: User): Promise<string> {
    hoisted.state.user = user;
    const r = await call(
      generateRoute.POST,
      `https://test.local/api/organizations/${orgId}/ai/generate`,
      { id: orgId },
      { method: "POST", body: JSON.stringify({ documentType: "general" }) },
    );
    expect(r.status).toBe(201);
    return (r.body as { aiRequest: { id: string } }).aiRequest.id;
  }

  it("requester happy path: returns 200 with preview envelope", async () => {
    const s = await setup();
    const aiRequestId = await generateAs(s.orgId, s.editor);
    const r = await call(
      previewRoute.GET,
      `https://test.local/api/organizations/${s.orgId}/ai/requests/${aiRequestId}/preview`,
      { id: s.orgId, aiRequestId },
    );
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      aiRequestId,
      organizationId: s.orgId,
      userId: s.editor.id,
      title: expect.any(String),
      content: expect.any(String),
      expiresAt: expect.any(String),
    });
  });

  it("same-org peer: returns 404 NOT_FOUND with no reason_code", async () => {
    const s = await setup();
    const aiRequestId = await generateAs(s.orgId, s.editor);
    hoisted.state.user = s.editorB;
    const r = await call(
      previewRoute.GET,
      `https://test.local/api/organizations/${s.orgId}/ai/requests/${aiRequestId}/preview`,
      { id: s.orgId, aiRequestId },
    );
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: "NOT_FOUND" });
  });

  it("cross-org actor: returns 404 NOT_FOUND with no reason_code", async () => {
    const s = await setup();
    const aiRequestId = await generateAs(s.orgId, s.editor);
    hoisted.state.user = s.outsider;
    const r = await call(
      previewRoute.GET,
      `https://test.local/api/organizations/${s.orgId}/ai/requests/${aiRequestId}/preview`,
      { id: s.orgId, aiRequestId },
    );
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: "NOT_FOUND" });
  });
});

// ---------------------------------------------------------------------
// DELETE /organizations/[id]/ai/requests/[aiRequestId]/preview
// ---------------------------------------------------------------------

describe("DELETE /organizations/[id]/ai/requests/[aiRequestId]/preview", () => {
  async function generateAs(orgId: string, user: User): Promise<string> {
    hoisted.state.user = user;
    const r = await call(
      generateRoute.POST,
      `https://test.local/api/organizations/${orgId}/ai/generate`,
      { id: orgId },
      { method: "POST", body: JSON.stringify({ documentType: "general" }) },
    );
    expect(r.status).toBe(201);
    return (r.body as { aiRequest: { id: string } }).aiRequest.id;
  }

  it("requester discard: 204, subsequent load is 404 NOT_FOUND", async () => {
    const s = await setup();
    const aiRequestId = await generateAs(s.orgId, s.editor);

    const del = await call(
      previewRoute.DELETE,
      `https://test.local/api/organizations/${s.orgId}/ai/requests/${aiRequestId}/preview`,
      { id: s.orgId, aiRequestId },
      { method: "DELETE" },
    );
    expect(del.status).toBe(204);
    expect(del.body).toBeNull();

    const get = await call(
      previewRoute.GET,
      `https://test.local/api/organizations/${s.orgId}/ai/requests/${aiRequestId}/preview`,
      { id: s.orgId, aiRequestId },
    );
    expect(get.status).toBe(404);
    expect(get.body).toEqual({ error: "NOT_FOUND" });
  });

  it("peer discard does NOT remove the original requester's preview", async () => {
    const s = await setup();
    const aiRequestId = await generateAs(s.orgId, s.editor);

    // editorB tries to discard editor's preview. Same-org membership
    // passes, but the underlying store key includes editorB.id so
    // the discard targets a non-existent slot. The route still
    // returns 204 (idempotent). That's the existence-leak guard.
    hoisted.state.user = s.editorB;
    const peerDel = await call(
      previewRoute.DELETE,
      `https://test.local/api/organizations/${s.orgId}/ai/requests/${aiRequestId}/preview`,
      { id: s.orgId, aiRequestId },
      { method: "DELETE" },
    );
    expect(peerDel.status).toBe(204);

    // Original requester's preview is still intact.
    hoisted.state.user = s.editor;
    const get = await call(
      previewRoute.GET,
      `https://test.local/api/organizations/${s.orgId}/ai/requests/${aiRequestId}/preview`,
      { id: s.orgId, aiRequestId },
    );
    expect(get.status).toBe(200);
    expect(r2(get).aiRequestId).toBe(aiRequestId);
  });

  it("cross-org discard returns 404, original preview preserved", async () => {
    const s = await setup();
    const aiRequestId = await generateAs(s.orgId, s.editor);

    hoisted.state.user = s.outsider;
    const r = await call(
      previewRoute.DELETE,
      `https://test.local/api/organizations/${s.orgId}/ai/requests/${aiRequestId}/preview`,
      { id: s.orgId, aiRequestId },
      { method: "DELETE" },
    );
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: "NOT_FOUND" });

    hoisted.state.user = s.editor;
    const get = await call(
      previewRoute.GET,
      `https://test.local/api/organizations/${s.orgId}/ai/requests/${aiRequestId}/preview`,
      { id: s.orgId, aiRequestId },
    );
    expect(get.status).toBe(200);
  });
});

function r2(env: Envelope): { aiRequestId: string } {
  return env.body as { aiRequestId: string };
}
