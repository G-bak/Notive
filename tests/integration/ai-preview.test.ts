// Phase D step 3 — AI preview short-term storage tests.
//
// Pins the contract that:
//
//   - On a successful generation, the preview body is saved into the
//     short-term store under a key scoped to (org, user, aiRequest).
//   - On a failed generation, NO preview entry is created.
//   - The read-side service `loadAiPreview` enforces:
//       cross-org actor             → NOT_FOUND (membership)
//       same-org peer (different    → NOT_FOUND (key mismatch — peer
//         userId in the lookup)         constructs a different key
//                                       that does not exist)
//       expired entry               → NOT_FOUND
//       discarded entry             → NOT_FOUND
//   - `discardAiPreview` is requester-only by virtue of the same key
//     boundary: a peer's discard call operates on a non-existent
//     key and leaves the original entry intact.
//   - Body retention: preview title and content are in the store but
//     do NOT show up in `ai_requests` / `ai_results` / `documents`.
//
// The tests use an injectable in-memory store with a controllable
// clock so TTL expiry is verified without sleeping.

import { describe, expect, it } from "vitest";

import { prisma } from "@notive/db";

import { buildPreviewKey, createInMemoryAiPreviewStore } from "../../apps/web/lib/ai/preview/store";
import { createMockAiProvider } from "../../apps/web/lib/ai/provider/mock";
import { generateAiDocument } from "../../apps/web/lib/services/ai-generation";
import { discardAiPreview, loadAiPreview } from "../../apps/web/lib/services/ai-preview";

import { createMembership, createOrganization, createUser } from "./src/helpers.js";

interface PreviewSetup {
  orgId: string;
  outsiderOrgId: string;
  editor: { id: string };
  editorB: { id: string };
  outsider: { id: string };
}

async function setup(): Promise<PreviewSetup> {
  const admin = await createUser("admin");
  const orgId = await createOrganization(admin.id, "ai-preview-org");
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

  const outsider = await createUser("outsider");
  const outsiderOrgId = await createOrganization(outsider.id, "ai-preview-outside");
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
    outsider: { id: outsider.id },
  };
}

describe("preview store key shape", () => {
  it("includes org, user, and aiRequest segments", () => {
    const key = buildPreviewKey({
      organizationId: "org-1",
      userId: "user-1",
      aiRequestId: "req-1",
    });
    expect(key).toBe("notive:ai:preview:org:org-1:user:user-1:req:req-1");
  });

  it("differs across organizations even with the same user / request", () => {
    const a = buildPreviewKey({
      organizationId: "org-A",
      userId: "u",
      aiRequestId: "r",
    });
    const b = buildPreviewKey({
      organizationId: "org-B",
      userId: "u",
      aiRequestId: "r",
    });
    expect(a).not.toBe(b);
  });

  it("differs across users even with the same org / request", () => {
    const a = buildPreviewKey({
      organizationId: "o",
      userId: "user-A",
      aiRequestId: "r",
    });
    const b = buildPreviewKey({
      organizationId: "o",
      userId: "user-B",
      aiRequestId: "r",
    });
    expect(a).not.toBe(b);
  });
});

describe("generateAiDocument — preview is saved to the store on Completed", () => {
  it("happy path: loadAiPreview returns the same body that generateAiDocument produced", async () => {
    const s = await setup();
    const store = createInMemoryAiPreviewStore();
    const out = await generateAiDocument(
      prisma,
      s.editor.id,
      s.orgId,
      { documentType: "weekly-report", purpose: "summary" },
      { previewStore: store },
    );
    expect(out.preview).not.toBeNull();
    expect(out.preview!.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const loaded = await loadAiPreview(prisma, s.editor.id, s.orgId, out.aiRequest.id, { store });
    expect(loaded.title).toBe(out.preview!.title);
    expect(loaded.content).toBe(out.preview!.content);
    expect(loaded.userId).toBe(s.editor.id);
    expect(loaded.organizationId).toBe(s.orgId);
    expect(loaded.aiRequestId).toBe(out.aiRequest.id);
    expect(loaded.expiresAt.getTime()).toBe(out.preview!.expiresAt.getTime());
  });
});

describe("generateAiDocument — failure path does NOT save a preview", () => {
  it("provider throw → loadAiPreview returns NOT_FOUND", async () => {
    const s = await setup();
    const store = createInMemoryAiPreviewStore();
    const provider = createMockAiProvider({ forceFailure: "provider_timeout" });
    const out = await generateAiDocument(
      prisma,
      s.editor.id,
      s.orgId,
      { documentType: "general" },
      { provider, previewStore: store },
    );
    expect(out.aiRequest.status).toBe("Failed");
    expect(out.preview).toBeNull();

    await expect(
      loadAiPreview(prisma, s.editor.id, s.orgId, out.aiRequest.id, { store }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("loadAiPreview — permission boundaries", () => {
  it("same-org peer cannot load another user's preview (key boundary)", async () => {
    const s = await setup();
    const store = createInMemoryAiPreviewStore();
    const out = await generateAiDocument(
      prisma,
      s.editor.id,
      s.orgId,
      { documentType: "general" },
      { previewStore: store },
    );
    await expect(
      loadAiPreview(prisma, s.editorB.id, s.orgId, out.aiRequest.id, { store }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Original requester still loads fine — peer's failed attempt did
    // not touch the entry.
    const loaded = await loadAiPreview(prisma, s.editor.id, s.orgId, out.aiRequest.id, { store });
    expect(loaded.content).toBe(out.preview!.content);
  });

  it("cross-org actor: NOT_FOUND from requireMembership before the store is touched", async () => {
    const s = await setup();
    const store = createInMemoryAiPreviewStore();
    const out = await generateAiDocument(
      prisma,
      s.editor.id,
      s.orgId,
      { documentType: "general" },
      { previewStore: store },
    );
    await expect(
      loadAiPreview(prisma, s.outsider.id, s.orgId, out.aiRequest.id, { store }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("non-existent aiRequestId for a valid member: NOT_FOUND", async () => {
    const s = await setup();
    const store = createInMemoryAiPreviewStore();
    await expect(
      loadAiPreview(prisma, s.editor.id, s.orgId, "00000000-0000-0000-0000-000000000000", {
        store,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("loadAiPreview — TTL expiry", () => {
  it("expired entry: load returns NOT_FOUND once clock passes expiresAt", async () => {
    const s = await setup();
    let frozen = new Date("2026-01-01T00:00:00Z");
    const store = createInMemoryAiPreviewStore({
      now: () => frozen,
      ttlMs: 60_000, // 1 minute for the test
    });

    const out = await generateAiDocument(
      prisma,
      s.editor.id,
      s.orgId,
      { documentType: "general" },
      { previewStore: store },
    );
    expect(out.preview!.expiresAt.getTime()).toBe(frozen.getTime() + 60_000);

    // Within TTL — load succeeds.
    const loaded = await loadAiPreview(prisma, s.editor.id, s.orgId, out.aiRequest.id, { store });
    expect(loaded.content).toBe(out.preview!.content);

    // Advance past expiresAt.
    frozen = new Date(out.preview!.expiresAt.getTime() + 1);
    await expect(
      loadAiPreview(prisma, s.editor.id, s.orgId, out.aiRequest.id, { store }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("discardAiPreview", () => {
  it("requester discard: subsequent load is NOT_FOUND", async () => {
    const s = await setup();
    const store = createInMemoryAiPreviewStore();
    const out = await generateAiDocument(
      prisma,
      s.editor.id,
      s.orgId,
      { documentType: "general" },
      { previewStore: store },
    );

    await discardAiPreview(prisma, s.editor.id, s.orgId, out.aiRequest.id, { store });
    await expect(
      loadAiPreview(prisma, s.editor.id, s.orgId, out.aiRequest.id, { store }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("idempotent: discarding a missing entry is a silent no-op", async () => {
    const s = await setup();
    const store = createInMemoryAiPreviewStore();
    await expect(
      discardAiPreview(prisma, s.editor.id, s.orgId, "00000000-0000-0000-0000-000000000000", {
        store,
      }),
    ).resolves.toBeUndefined();
  });

  it("peer discard does NOT affect the original entry (key boundary)", async () => {
    const s = await setup();
    const store = createInMemoryAiPreviewStore();
    const out = await generateAiDocument(
      prisma,
      s.editor.id,
      s.orgId,
      { documentType: "general" },
      { previewStore: store },
    );

    // editorB tries to discard editor's preview. The key includes
    // editorB.id so the discard hits a non-existent slot.
    await discardAiPreview(prisma, s.editorB.id, s.orgId, out.aiRequest.id, { store });

    // editor's preview is still intact.
    const loaded = await loadAiPreview(prisma, s.editor.id, s.orgId, out.aiRequest.id, { store });
    expect(loaded.content).toBe(out.preview!.content);
  });

  it("cross-org discard: NOT_FOUND from requireMembership, entry preserved", async () => {
    const s = await setup();
    const store = createInMemoryAiPreviewStore();
    const out = await generateAiDocument(
      prisma,
      s.editor.id,
      s.orgId,
      { documentType: "general" },
      { previewStore: store },
    );

    await expect(
      discardAiPreview(prisma, s.outsider.id, s.orgId, out.aiRequest.id, { store }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const loaded = await loadAiPreview(prisma, s.editor.id, s.orgId, out.aiRequest.id, { store });
    expect(loaded.content).toBe(out.preview!.content);
  });
});

describe("preview body retention", () => {
  it("preview body lives in the store but NOT in ai_requests / ai_results / documents", async () => {
    const s = await setup();
    const store = createInMemoryAiPreviewStore();
    const documentsBefore = await prisma.document.count({
      where: { organizationId: s.orgId },
    });

    const out = await generateAiDocument(
      prisma,
      s.editor.id,
      s.orgId,
      { documentType: "retention-marker", purpose: "store-only" },
      { previewStore: store },
    );
    expect(out.preview).not.toBeNull();
    const previewTitle = out.preview!.title;
    const previewContent = out.preview!.content;

    // Body IS in the store.
    const loaded = await loadAiPreview(prisma, s.editor.id, s.orgId, out.aiRequest.id, { store });
    expect(loaded.title).toBe(previewTitle);
    expect(loaded.content).toBe(previewContent);

    // Body is NOT in the persisted ai_requests row.
    const aiRequestRow = await prisma.aiRequest.findUniqueOrThrow({
      where: { id: out.aiRequest.id },
    });
    expect(JSON.stringify(aiRequestRow)).not.toContain(previewTitle);
    expect(JSON.stringify(aiRequestRow)).not.toContain(previewContent);

    // Body is NOT in the persisted ai_results row.
    const aiResultRow = await prisma.aiResult.findUniqueOrThrow({
      where: { id: out.aiResult.id },
    });
    expect(JSON.stringify(aiResultRow)).not.toContain(previewTitle);
    expect(JSON.stringify(aiResultRow)).not.toContain(previewContent);

    // Body is NOT in any ai_references row (the audit snapshot only
    // carries target metadata).
    const refRows = await prisma.aiReference.findMany({
      where: { aiRequestId: out.aiRequest.id },
    });
    for (const ref of refRows) {
      expect(JSON.stringify(ref)).not.toContain(previewTitle);
      expect(JSON.stringify(ref)).not.toContain(previewContent);
    }

    // Body is NOT in any documents row (no save handoff has happened
    // yet in Phase D).
    const documentsAfter = await prisma.document.count({
      where: { organizationId: s.orgId },
    });
    expect(documentsAfter).toBe(documentsBefore);
  });
});
