// Phase D step 5 - AI preview save-to-document route smoke tests.
//
// Pins the most security-sensitive transition in the AI flow: the
// moment preview body first lands in a permanent `documents` row.
//
// Route under test:
//   POST /api/organizations/[id]/ai/requests/[aiRequestId]/save
//
// Boundaries pinned here:
//
//   - Session user is the only actor; no body fields trusted.
//   - Same-org peer / cross-org actor on someone else's request ->
//     NOT_FOUND (existence-leak guard).
//   - Failed AI request -> CONFLICT(ai_request_not_saveable); preview
//     never existed so it cannot be saved.
//   - Duplicate save -> CONFLICT(ai_request_already_saved) AND no
//     second `documents` row is created (transaction atomicity).
//   - Successful save: documents row has sourceType=AI and aiRequestId
//     set, document_versions row #1 exists, ai_result.status=Saved
//     with savedDocumentId, ai_request.resultSaved=true. Preview load
//     after save is NOT_FOUND.
//   - malformed aiRequestId path segment -> 400 INVALID_INPUT, NOT a
//     500 from Postgres uuid-parse.
//
// Strategy follows Step 4 smoke pattern: vi.mock the session module
// with a hoisted user, real DB via the integration embedded-postgres
// setup, real services. Preview state is established by calling the
// underlying `generateAiDocument` service (not the Step 4 route) so
// this file does not depend on Step 4 routes being on the same
// branch as Step 5.

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
        id: "ai-save-smoke-session",
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

// Wrap the mock provider factory so a single test can drive a Failed
// lifecycle by flipping `forceProviderFailure`. Same pattern as the
// Step 4 smoke file.
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

import { generateAiDocument } from "../../apps/web/lib/services/ai-generation";
import { loadAiPreview } from "../../apps/web/lib/services/ai-preview";
import * as saveRoute from "../../apps/web/app/api/organizations/[id]/ai/requests/[aiRequestId]/save/route";

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
  const orgId = await createOrganization(adminRow.id, "ai-save-org");
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
  const outsiderOrgId = await createOrganization(outsiderRow.id, "ai-save-outside");
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

interface PreparedGeneration {
  aiRequestId: string;
  previewTitle: string;
  previewContent: string;
}

async function prepareCompletedGeneration(
  orgId: string,
  user: User,
  overrides: { purpose?: string } = {},
): Promise<PreparedGeneration> {
  const out = await generateAiDocument(prisma, user.id, orgId, {
    documentType: "weekly-report",
    purpose: overrides.purpose ?? "summary",
  });
  if (out.preview === null) {
    throw new Error("expected Completed preview in fixture");
  }
  return {
    aiRequestId: out.aiRequest.id,
    previewTitle: out.preview.title,
    previewContent: out.preview.content,
  };
}

// ---------------------------------------------------------------------
// POST /organizations/[id]/ai/requests/[aiRequestId]/save
// ---------------------------------------------------------------------

describe("POST /organizations/[id]/ai/requests/[aiRequestId]/save", () => {
  it("unauthenticated returns 401 UNAUTHORIZED envelope", async () => {
    const s = await setup();
    const prep = await prepareCompletedGeneration(s.orgId, s.editor);
    // hoisted.state.user intentionally null.
    const r = await call(
      saveRoute.POST,
      `https://test.local/api/organizations/${s.orgId}/ai/requests/${prep.aiRequestId}/save`,
      { id: s.orgId, aiRequestId: prep.aiRequestId },
      { method: "POST" },
    );
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({
      error: "UNAUTHORIZED",
      reason_code: "UNAUTHORIZED",
    });
  });

  it("requester happy path: 201 with full linkage and version #1, preview discarded", async () => {
    const s = await setup();
    const prep = await prepareCompletedGeneration(s.orgId, s.editor);
    hoisted.state.user = s.editor;

    const r = await call(
      saveRoute.POST,
      `https://test.local/api/organizations/${s.orgId}/ai/requests/${prep.aiRequestId}/save`,
      { id: s.orgId, aiRequestId: prep.aiRequestId },
      { method: "POST" },
    );
    expect(r.status).toBe(201);
    const body = r.body as {
      document: {
        id: string;
        status: string;
        sourceType: string;
        aiRequestId: string | null;
        title: string;
        content: string;
        documentType: string;
        ownerUserId: string | null;
        authorUserId: string | null;
        visibility: string;
      };
      aiRequest: { id: string; resultSaved: boolean; status: string };
      aiResult: { status: string; savedDocumentId: string | null };
    };

    expect(body.document).toMatchObject({
      status: "Draft",
      sourceType: "AI",
      aiRequestId: prep.aiRequestId,
      title: prep.previewTitle,
      content: prep.previewContent,
      documentType: "weekly-report",
      ownerUserId: s.editor.id,
      authorUserId: s.editor.id,
      visibility: "Private",
    });
    expect(body.aiRequest).toMatchObject({
      id: prep.aiRequestId,
      status: "Completed",
      resultSaved: true,
    });
    expect(body.aiResult).toMatchObject({
      status: "Saved",
      savedDocumentId: body.document.id,
    });

    // Persisted state confirms the response.
    const docRow = await prisma.document.findUniqueOrThrow({
      where: { id: body.document.id },
    });
    expect(docRow.sourceType).toBe("AI");
    expect(docRow.aiRequestId).toBe(prep.aiRequestId);
    expect(docRow.title).toBe(prep.previewTitle);
    expect(docRow.content).toBe(prep.previewContent);

    const versions = await prisma.documentVersion.findMany({
      where: { documentId: body.document.id },
      orderBy: { versionNumber: "asc" },
    });
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      versionNumber: 1,
      titleSnapshot: prep.previewTitle,
      contentSnapshot: prep.previewContent,
      changedByUserId: s.editor.id,
    });

    const requestRow = await prisma.aiRequest.findUniqueOrThrow({
      where: { id: prep.aiRequestId },
    });
    expect(requestRow.resultSaved).toBe(true);

    const resultRow = await prisma.aiResult.findFirstOrThrow({
      where: { aiRequestId: prep.aiRequestId },
    });
    expect(resultRow.status).toBe("Saved");
    expect(resultRow.savedDocumentId).toBe(body.document.id);

    // Preview is discarded after a successful save.
    await expect(
      loadAiPreview(prisma, s.editor.id, s.orgId, prep.aiRequestId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("route ignores client-supplied userId / sourceType / content / aiRequestId in body", async () => {
    const s = await setup();
    const prep = await prepareCompletedGeneration(s.orgId, s.editor, { purpose: "marker" });
    hoisted.state.user = s.editor;

    const spoofedBody = JSON.stringify({
      userId: s.outsider.id,
      sourceType: "Manual",
      aiRequestId: "00000000-0000-0000-0000-000000000000",
      content: "client-supplied-evil-content",
      title: "client-supplied-evil-title",
    });
    const r = await call(
      saveRoute.POST,
      `https://test.local/api/organizations/${s.orgId}/ai/requests/${prep.aiRequestId}/save`,
      { id: s.orgId, aiRequestId: prep.aiRequestId },
      { method: "POST", body: spoofedBody },
    );
    expect(r.status).toBe(201);
    const body = r.body as {
      document: {
        sourceType: string;
        aiRequestId: string | null;
        content: string;
        title: string;
        authorUserId: string | null;
        ownerUserId: string | null;
      };
    };
    // sourceType comes from service (AI), not client.
    expect(body.document.sourceType).toBe("AI");
    // aiRequestId is from URL param, not body.
    expect(body.document.aiRequestId).toBe(prep.aiRequestId);
    // Content/title comes from preview, not body.
    expect(body.document.content).toBe(prep.previewContent);
    expect(body.document.title).toBe(prep.previewTitle);
    expect(body.document.content).not.toContain("client-supplied-evil-content");
    expect(body.document.title).not.toContain("client-supplied-evil-title");
    // Actor is session user, not body.
    expect(body.document.authorUserId).toBe(s.editor.id);
    expect(body.document.ownerUserId).toBe(s.editor.id);
  });

  it("same-org peer save returns 404 NOT_FOUND with no reason_code", async () => {
    const s = await setup();
    const prep = await prepareCompletedGeneration(s.orgId, s.editor);
    hoisted.state.user = s.editorB;
    const r = await call(
      saveRoute.POST,
      `https://test.local/api/organizations/${s.orgId}/ai/requests/${prep.aiRequestId}/save`,
      { id: s.orgId, aiRequestId: prep.aiRequestId },
      { method: "POST" },
    );
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: "NOT_FOUND" });
    // Original requester's request is untouched.
    const requestRow = await prisma.aiRequest.findUniqueOrThrow({
      where: { id: prep.aiRequestId },
    });
    expect(requestRow.resultSaved).toBe(false);
    const docCount = await prisma.document.count({
      where: { aiRequestId: prep.aiRequestId },
    });
    expect(docCount).toBe(0);
  });

  it("cross-org actor save returns 404 NOT_FOUND with no reason_code", async () => {
    const s = await setup();
    const prep = await prepareCompletedGeneration(s.orgId, s.editor);
    hoisted.state.user = s.outsider;
    const r = await call(
      saveRoute.POST,
      `https://test.local/api/organizations/${s.orgId}/ai/requests/${prep.aiRequestId}/save`,
      { id: s.orgId, aiRequestId: prep.aiRequestId },
      { method: "POST" },
    );
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: "NOT_FOUND" });
  });

  it("viewer save against another user's request returns 404 NOT_FOUND", async () => {
    const s = await setup();
    const prep = await prepareCompletedGeneration(s.orgId, s.editor);
    hoisted.state.user = s.viewer;
    const r = await call(
      saveRoute.POST,
      `https://test.local/api/organizations/${s.orgId}/ai/requests/${prep.aiRequestId}/save`,
      { id: s.orgId, aiRequestId: prep.aiRequestId },
      { method: "POST" },
    );
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: "NOT_FOUND" });
  });

  it("downgraded requester cannot save because save creates a document", async () => {
    const s = await setup();
    const prep = await prepareCompletedGeneration(s.orgId, s.editor);
    await prisma.membership.updateMany({
      where: { userId: s.editor.id, organizationId: s.orgId },
      data: { role: "Viewer" },
    });

    hoisted.state.user = s.editor;
    const r = await call(
      saveRoute.POST,
      `https://test.local/api/organizations/${s.orgId}/ai/requests/${prep.aiRequestId}/save`,
      { id: s.orgId, aiRequestId: prep.aiRequestId },
      { method: "POST" },
    );
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({
      error: "FORBIDDEN",
      reason_code: "document_create_not_allowed",
    });
    const docCount = await prisma.document.count({
      where: { aiRequestId: prep.aiRequestId },
    });
    expect(docCount).toBe(0);
  });

  it("failed AI request save returns CONFLICT(ai_request_not_saveable), no document", async () => {
    const s = await setup();
    hoisted.state.forceProviderFailure = "provider_timeout";
    // Generation with forced failure -> request status=Failed, no preview.
    const out = await generateAiDocument(prisma, s.editor.id, s.orgId, {
      documentType: "general",
    });
    expect(out.aiRequest.status).toBe("Failed");
    expect(out.preview).toBeNull();
    hoisted.state.forceProviderFailure = null;

    hoisted.state.user = s.editor;
    const r = await call(
      saveRoute.POST,
      `https://test.local/api/organizations/${s.orgId}/ai/requests/${out.aiRequest.id}/save`,
      { id: s.orgId, aiRequestId: out.aiRequest.id },
      { method: "POST" },
    );
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({
      error: "CONFLICT",
      reason_code: "ai_request_not_saveable",
    });
    const docCount = await prisma.document.count({
      where: { aiRequestId: out.aiRequest.id },
    });
    expect(docCount).toBe(0);
  });

  it("request with multiple Generated results is not saveable and creates no document", async () => {
    const s = await setup();
    const prep = await prepareCompletedGeneration(s.orgId, s.editor);
    await prisma.aiResult.create({
      data: {
        aiRequestId: prep.aiRequestId,
        organizationId: s.orgId,
        status: "Generated",
      },
    });

    hoisted.state.user = s.editor;
    const r = await call(
      saveRoute.POST,
      `https://test.local/api/organizations/${s.orgId}/ai/requests/${prep.aiRequestId}/save`,
      { id: s.orgId, aiRequestId: prep.aiRequestId },
      { method: "POST" },
    );
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({
      error: "CONFLICT",
      reason_code: "ai_result_not_saveable",
    });
    const docCount = await prisma.document.count({
      where: { aiRequestId: prep.aiRequestId },
    });
    expect(docCount).toBe(0);
    const requestRow = await prisma.aiRequest.findUniqueOrThrow({
      where: { id: prep.aiRequestId },
    });
    expect(requestRow.resultSaved).toBe(false);
  });

  it("duplicate save returns CONFLICT(ai_request_already_saved) and does NOT create a second document", async () => {
    const s = await setup();
    const prep = await prepareCompletedGeneration(s.orgId, s.editor);
    hoisted.state.user = s.editor;

    const first = await call(
      saveRoute.POST,
      `https://test.local/api/organizations/${s.orgId}/ai/requests/${prep.aiRequestId}/save`,
      { id: s.orgId, aiRequestId: prep.aiRequestId },
      { method: "POST" },
    );
    expect(first.status).toBe(201);
    const firstDocId = (first.body as { document: { id: string } }).document.id;

    const second = await call(
      saveRoute.POST,
      `https://test.local/api/organizations/${s.orgId}/ai/requests/${prep.aiRequestId}/save`,
      { id: s.orgId, aiRequestId: prep.aiRequestId },
      { method: "POST" },
    );
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({
      error: "CONFLICT",
      reason_code: "ai_request_already_saved",
    });

    // Atomicity check: exactly one document is linked to this request.
    const docs = await prisma.document.findMany({
      where: { aiRequestId: prep.aiRequestId },
    });
    expect(docs).toHaveLength(1);
    expect(docs[0]?.id).toBe(firstDocId);

    // ai_result still points at the first document and remains Saved.
    const resultRow = await prisma.aiResult.findFirstOrThrow({
      where: { aiRequestId: prep.aiRequestId },
    });
    expect(resultRow.status).toBe("Saved");
    expect(resultRow.savedDocumentId).toBe(firstDocId);

    // ai_request still resultSaved=true (the second attempt did not
    // un-flip anything).
    const requestRow = await prisma.aiRequest.findUniqueOrThrow({
      where: { id: prep.aiRequestId },
    });
    expect(requestRow.resultSaved).toBe(true);
  });

  it("malformed aiRequestId path returns 400 INVALID_INPUT, not 500 uuid-parse", async () => {
    const s = await setup();
    hoisted.state.user = s.editor;
    const r = await call(
      saveRoute.POST,
      `https://test.local/api/organizations/${s.orgId}/ai/requests/not-a-uuid/save`,
      { id: s.orgId, aiRequestId: "not-a-uuid" },
      { method: "POST" },
    );
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: "INVALID_INPUT" });
  });

  it("non-existent aiRequestId returns 404 NOT_FOUND", async () => {
    const s = await setup();
    hoisted.state.user = s.editor;
    const r = await call(
      saveRoute.POST,
      `https://test.local/api/organizations/${s.orgId}/ai/requests/00000000-0000-0000-0000-000000000000/save`,
      { id: s.orgId, aiRequestId: "00000000-0000-0000-0000-000000000000" },
      { method: "POST" },
    );
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: "NOT_FOUND" });
  });
});
