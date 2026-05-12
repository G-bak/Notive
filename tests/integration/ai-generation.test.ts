// Phase D step 2 — mock-first AI generation service integration tests.
//
// Pins the contract that the generation service:
//
//   - Drives the lifecycle Pending → Processing → Completed | Failed
//     through the Step 1 metadata service without bypassing its
//     entry points (Viewer rejection, requester-only access).
//   - Filters reference documents through `evaluateDocumentPermission`
//     BEFORE the provider call. Cross-org and no-view references land
//     in the audit snapshot with `accessAllowed: false` and are
//     DROPPED from the provider input (CLAUDE.md §4.5).
//   - Never persists prompt or response body in `ai_requests` or
//     `ai_results`. The preview envelope is returned in memory only
//     and does not show up in a `documents` row (the editor / save
//     handoff is a later Phase D step).
//   - Transitions to Failed and records a Failed `ai_results` row
//     when the provider throws, while still capturing the reference
//     audit snapshot.

import { describe, expect, it } from "vitest";

import { prisma } from "@notive/db";

import { generateAiDocument } from "../../apps/web/lib/services/ai-generation";
import { createMockAiProvider, MockProviderError } from "../../apps/web/lib/ai/provider/mock";
import { createDocument } from "../../apps/web/lib/services/document";

import { createMembership, createOrganization, createUser } from "./src/helpers.js";

interface GenSetup {
  orgId: string;
  outsiderOrgId: string;
  editor: { id: string };
  editorB: { id: string };
  viewer: { id: string };
  outsider: { id: string };
}

async function setup(): Promise<GenSetup> {
  const admin = await createUser("admin");
  const orgId = await createOrganization(admin.id, "ai-gen-org");
  await createMembership({
    userId: admin.id,
    organizationId: orgId,
    role: "Admin",
    status: "Active",
  });

  const editor = await createUser("editor");
  await createMembership({
    userId: editor.id,
    organizationId: orgId,
    role: "Editor",
    status: "Active",
  });

  const editorB = await createUser("editorB");
  await createMembership({
    userId: editorB.id,
    organizationId: orgId,
    role: "Editor",
    status: "Active",
  });

  const viewer = await createUser("viewer");
  await createMembership({
    userId: viewer.id,
    organizationId: orgId,
    role: "Viewer",
    status: "Active",
  });

  const outsider = await createUser("outsider");
  const outsiderOrgId = await createOrganization(outsider.id, "ai-gen-outside");
  await createMembership({
    userId: outsider.id,
    organizationId: outsiderOrgId,
    role: "Admin",
    status: "Active",
  });

  return {
    orgId,
    outsiderOrgId,
    editor: { id: editor.id },
    editorB: { id: editorB.id },
    viewer: { id: viewer.id },
    outsider: { id: outsider.id },
  };
}

describe("generateAiDocument — happy path", () => {
  it("Editor: end-to-end Completed lifecycle with allowed reference", async () => {
    const s = await setup();
    const refDoc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "weekly-data",
      documentType: "general",
      visibility: "Private",
    });

    const out = await generateAiDocument(prisma, s.editor.id, s.orgId, {
      documentType: "weekly-report",
      purpose: "summary",
      audience: "team",
      tone: "concise",
      referenceDocumentIds: [refDoc.id],
    });

    expect(out.aiRequest.status).toBe("Completed");
    expect(out.aiRequest.startedAt).not.toBeNull();
    expect(out.aiRequest.completedAt).not.toBeNull();
    expect(out.aiRequest.tokenCountInput).toBeGreaterThan(0);
    expect(out.aiRequest.tokenCountOutput).toBeGreaterThan(0);
    expect(out.aiRequest.latencyMs).not.toBeNull();
    expect(out.aiResult.status).toBe("Generated");
    expect(out.aiResult.errorCode).toBeNull();
    expect(out.aiResult.savedDocumentId).toBeNull();

    expect(out.references).toHaveLength(1);
    expect(out.references[0]).toMatchObject({
      targetType: "Document",
      targetId: refDoc.id,
      targetTitle: "weekly-data",
      accessAllowed: true,
    });

    expect(out.preview).not.toBeNull();
    expect(out.preview!.title).toContain("weekly-report");
    expect(out.preview!.content).toContain("weekly-data");
  });

  it("no references: succeeds with empty audit list and provider sees empty refs", async () => {
    const s = await setup();
    const out = await generateAiDocument(prisma, s.editor.id, s.orgId, {
      documentType: "general",
    });
    expect(out.aiRequest.status).toBe("Completed");
    expect(out.references).toHaveLength(0);
    expect(out.preview).not.toBeNull();
    expect(out.preview!.content).toContain("no references");
  });
});

describe("generateAiDocument — role gating", () => {
  it("Viewer: rejected at createAiRequest with FORBIDDEN(ai_request_create_not_allowed)", async () => {
    const s = await setup();
    await expect(
      generateAiDocument(prisma, s.viewer.id, s.orgId, {
        documentType: "general",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      reason: "ai_request_create_not_allowed",
    });
    // No ai_requests row should have been left behind.
    const count = await prisma.aiRequest.count({
      where: { organizationId: s.orgId, requestedByUserId: s.viewer.id },
    });
    expect(count).toBe(0);
  });

  it("cross-org actor: NOT_FOUND from requireMembership", async () => {
    const s = await setup();
    await expect(
      generateAiDocument(prisma, s.outsider.id, s.orgId, {
        documentType: "general",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("generateAiDocument — reference permission filtering", () => {
  it("cross-org reference: blocked, recorded as accessAllowed=false, not in provider input", async () => {
    const s = await setup();
    const outsiderDoc = await createDocument(prisma, s.outsider.id, s.outsiderOrgId, {
      title: "foreign-secret",
      documentType: "general",
      visibility: "Private",
    });

    const out = await generateAiDocument(prisma, s.editor.id, s.orgId, {
      documentType: "general",
      referenceDocumentIds: [outsiderDoc.id],
    });

    expect(out.aiRequest.status).toBe("Completed");
    expect(out.references).toHaveLength(1);
    expect(out.references[0]).toMatchObject({
      targetType: "Document",
      targetId: outsiderDoc.id,
      targetTitle: null,
      accessAllowed: false,
    });
    // Cross-org document's title MUST NOT leak into the preview body
    // (provider received zero allowed refs for this request).
    expect(out.preview).not.toBeNull();
    expect(out.preview!.content).not.toContain("foreign-secret");
    expect(out.preview!.content).toContain("no references");
  });

  it("same-org no-view reference (peer's Private doc): blocked, recorded as accessAllowed=false", async () => {
    const s = await setup();
    const peerDoc = await createDocument(prisma, s.editorB.id, s.orgId, {
      title: "peer-private",
      documentType: "general",
      visibility: "Private",
    });

    const out = await generateAiDocument(prisma, s.editor.id, s.orgId, {
      documentType: "general",
      referenceDocumentIds: [peerDoc.id],
    });

    expect(out.aiRequest.status).toBe("Completed");
    expect(out.references).toHaveLength(1);
    expect(out.references[0]).toMatchObject({
      targetType: "Document",
      targetId: peerDoc.id,
      targetTitle: null,
      accessAllowed: false,
    });
    expect(out.preview).not.toBeNull();
    expect(out.preview!.content).not.toContain("peer-private");
    expect(out.preview!.content).toContain("no references");
  });

  it("mixed allowed + blocked: only allowed reach the provider, both recorded", async () => {
    const s = await setup();
    const allowedDoc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "ok-ref",
      documentType: "general",
      visibility: "Private",
    });
    const peerDoc = await createDocument(prisma, s.editorB.id, s.orgId, {
      title: "blocked-ref",
      documentType: "general",
      visibility: "Private",
    });

    const out = await generateAiDocument(prisma, s.editor.id, s.orgId, {
      documentType: "general",
      referenceDocumentIds: [allowedDoc.id, peerDoc.id],
    });

    expect(out.aiRequest.status).toBe("Completed");
    expect(out.references).toHaveLength(2);
    const byId = new Map(out.references.map((r) => [r.targetId, r]));
    expect(byId.get(allowedDoc.id)).toMatchObject({
      accessAllowed: true,
      targetTitle: "ok-ref",
    });
    expect(byId.get(peerDoc.id)).toMatchObject({
      accessAllowed: false,
      targetTitle: null,
    });
    expect(out.preview!.content).toContain("ok-ref");
    expect(out.preview!.content).not.toContain("blocked-ref");
  });

  it("too many references: INVALID_INPUT, no ai_request row written", async () => {
    const s = await setup();
    const ids = Array.from(
      { length: 11 },
      (_, i) => `00000000-0000-0000-0000-${(i + 1).toString().padStart(12, "0")}`,
    );
    const before = await prisma.aiRequest.count({ where: { organizationId: s.orgId } });
    await expect(
      generateAiDocument(prisma, s.editor.id, s.orgId, {
        documentType: "general",
        referenceDocumentIds: ids,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const after = await prisma.aiRequest.count({ where: { organizationId: s.orgId } });
    expect(after).toBe(before);
  });

  it("invalid reference UUID: INVALID_INPUT before ai_request row is written", async () => {
    const s = await setup();
    const before = await prisma.aiRequest.count({ where: { organizationId: s.orgId } });
    await expect(
      generateAiDocument(prisma, s.editor.id, s.orgId, {
        documentType: "general",
        referenceDocumentIds: ["not-a-uuid"],
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const after = await prisma.aiRequest.count({ where: { organizationId: s.orgId } });
    expect(after).toBe(before);
  });
});

describe("generateAiDocument — body retention", () => {
  it("preview body does NOT land in ai_results / ai_requests / documents", async () => {
    const s = await setup();
    const documentsBefore = await prisma.document.count({
      where: { organizationId: s.orgId },
    });

    const out = await generateAiDocument(prisma, s.editor.id, s.orgId, {
      documentType: "report-marker",
      purpose: "marker-purpose",
    });
    expect(out.preview).not.toBeNull();
    const previewTitle = out.preview!.title;
    const previewContent = out.preview!.content;

    // The persisted ai_request row carries only structured metadata,
    // never the preview text. Same for the result row.
    const aiRequestRow = await prisma.aiRequest.findUniqueOrThrow({
      where: { id: out.aiRequest.id },
    });
    expect(JSON.stringify(aiRequestRow)).not.toContain(previewTitle);
    expect(JSON.stringify(aiRequestRow)).not.toContain(previewContent);

    const aiResultRow = await prisma.aiResult.findUniqueOrThrow({
      where: { id: out.aiResult.id },
    });
    expect(JSON.stringify(aiResultRow)).not.toContain(previewTitle);
    expect(JSON.stringify(aiResultRow)).not.toContain(previewContent);
    // Result row's typed keys explicitly do not include body fields.
    const keys = Object.keys(aiResultRow);
    expect(keys).not.toContain("title");
    expect(keys).not.toContain("content");
    expect(keys).not.toContain("body");

    // No `documents` row is created as a side effect — the editor /
    // save handoff is a later Phase D step.
    const documentsAfter = await prisma.document.count({
      where: { organizationId: s.orgId },
    });
    expect(documentsAfter).toBe(documentsBefore);
  });
});

describe("generateAiDocument — failure path", () => {
  it("provider throw: request → Failed, result.status=Failed, refs still recorded", async () => {
    const s = await setup();
    const refDoc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "ref-during-failure",
      documentType: "general",
      visibility: "Private",
    });

    const provider = createMockAiProvider({ forceFailure: "provider_timeout" });
    const out = await generateAiDocument(
      prisma,
      s.editor.id,
      s.orgId,
      {
        documentType: "general",
        referenceDocumentIds: [refDoc.id],
      },
      { provider },
    );

    expect(out.aiRequest.status).toBe("Failed");
    expect(out.aiRequest.errorCode).toBe("provider_timeout");
    expect(out.aiRequest.completedAt).not.toBeNull();
    expect(out.aiResult.status).toBe("Failed");
    expect(out.aiResult.errorCode).toBe("provider_timeout");
    expect(out.references).toHaveLength(1);
    expect(out.references[0]).toMatchObject({
      targetId: refDoc.id,
      accessAllowed: true,
    });
    expect(out.preview).toBeNull();
  });

  it("non-MockProviderError throw: maps to errorCode=provider_unknown_error", async () => {
    const s = await setup();
    const flakyProvider = {
      async generate() {
        throw new Error("boom");
      },
    };
    const out = await generateAiDocument(
      prisma,
      s.editor.id,
      s.orgId,
      { documentType: "general" },
      { provider: flakyProvider },
    );
    expect(out.aiRequest.status).toBe("Failed");
    expect(out.aiRequest.errorCode).toBe("provider_unknown_error");
    expect(out.aiResult.status).toBe("Failed");
    expect(out.preview).toBeNull();
  });
});

// Requester-only access is fully pinned by Step 1's metadata-service
// tests (`ai-request-metadata.test.ts`); the generation service
// surface re-uses those entry points without widening the surface, so
// we do not re-pin the same invariants here.
