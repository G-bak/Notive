// Phase D step 1 — AI metadata service integration tests.
//
// Pins the contract that:
//   - Prompt body and response body are NOT persisted (schema-level
//     check on `ai_requests` and `ai_results` columns).
//   - The 4 AI tables exist with the expected status enums.
//   - Service entry points enforce membership + Viewer rejection +
//     cross-org NOT_FOUND.
//   - Status transitions follow the Pending → Processing →
//     Completed/Failed/Cancelled lifecycle, with terminal states truly
//     terminal.
//   - `documents.ai_request_id` is a real FK to `ai_requests(id)` — a
//     bogus UUID is rejected by Postgres, and deleting the parent
//     `ai_requests` row sets the child `documents.ai_request_id` to
//     NULL (the 90-day retention cleanup invariant).
//   - `ai_results.ai_request_id` cross-org mix is rejected at the DB
//     layer via the composite FK.
//   - Cross-org references can be recorded with `accessAllowed: false`
//     (audit snapshot pattern) but service callers must still pass
//     same-org parent ids; the service does not implicitly let a
//     stranger create AI rows in a foreign org.
//
// Body-retention test takes the schema as the source of truth: it
// reads `information_schema.columns` and asserts that no
// prompt/response-body column exists on `ai_requests` / `ai_results`.

import { Prisma } from "@notive/db";
import { describe, expect, it } from "vitest";

import { prisma } from "@notive/db";
import { ApiError } from "@notive/permissions";

import {
  createAiRequest,
  recordAiReferences,
  recordAiResult,
  transitionAiRequestStatus,
} from "../../apps/web/lib/services/ai-request";
import { createDocument } from "../../apps/web/lib/services/document";

import { createMembership, createOrganization, createUser } from "./src/helpers.js";

async function expectApiError(
  promise: Promise<unknown>,
  code: ApiError["code"],
  reason?: string | null,
): Promise<void> {
  await expect(promise).rejects.toMatchObject(
    reason !== undefined ? { code, reason } : { code },
  );
}

interface AiTestSetup {
  orgId: string;
  outsiderOrgId: string;
  editor: { id: string };
  editorB: { id: string };
  viewer: { id: string };
  outsider: { id: string };
}

async function setup(): Promise<AiTestSetup> {
  const adminRow = await createUser("admin");
  const orgId = await createOrganization(adminRow.id, "ai-org");
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
  const outsiderOrgId = await createOrganization(outsiderRow.id, "ai-outside");
  await createMembership({
    userId: outsiderRow.id,
    organizationId: outsiderOrgId,
    role: "Admin",
    status: "Active",
  });

  return {
    orgId,
    outsiderOrgId,
    editor: { id: editorRow.id },
    editorB: { id: editorBRow.id },
    viewer: { id: viewerRow.id },
    outsider: { id: outsiderRow.id },
  };
}

// ---------------------------------------------------------------------
// Schema-level body-retention guarantees
// ---------------------------------------------------------------------

describe("AI metadata schema (Phase D step 1)", () => {
  it("ai_requests has NO prompt / request body column", async () => {
    const cols = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ai_requests'
    `;
    const names = cols.map((c) => c.column_name);
    expect(names).not.toContain("request_text");
    expect(names).not.toContain("prompt");
    expect(names).not.toContain("prompt_text");
    expect(names).not.toContain("content");
    expect(names).not.toContain("body");
  });

  it("ai_results has NO title / response body column", async () => {
    const cols = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ai_results'
    `;
    const names = cols.map((c) => c.column_name);
    expect(names).not.toContain("title");
    expect(names).not.toContain("content");
    expect(names).not.toContain("body");
    expect(names).not.toContain("response_text");
    expect(names).not.toContain("error_message");
  });

  it("ai_requests, ai_results, ai_references, ai_usage_logs tables exist", async () => {
    const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('ai_requests', 'ai_results', 'ai_references', 'ai_usage_logs')
    `;
    const names = new Set(rows.map((r) => r.table_name));
    expect(names.has("ai_requests")).toBe(true);
    expect(names.has("ai_results")).toBe(true);
    expect(names.has("ai_references")).toBe(true);
    expect(names.has("ai_usage_logs")).toBe(true);
  });
});

// ---------------------------------------------------------------------
// createAiRequest
// ---------------------------------------------------------------------

describe("createAiRequest", () => {
  it("Editor: creates a Pending request with metadata only", async () => {
    const s = await setup();
    const req = await createAiRequest(prisma, s.editor.id, s.orgId, {
      documentType: "general",
      purpose: "weekly recap",
      audience: "team",
      tone: "concise",
    });
    expect(req).toMatchObject({
      organizationId: s.orgId,
      requestedByUserId: s.editor.id,
      documentType: "general",
      purpose: "weekly recap",
      audience: "team",
      tone: "concise",
      status: "Pending",
      resultSaved: false,
      startedAt: null,
      completedAt: null,
      errorCode: null,
    });
  });

  it("Viewer: rejected with FORBIDDEN(ai_request_create_not_allowed)", async () => {
    const s = await setup();
    await expectApiError(
      createAiRequest(prisma, s.viewer.id, s.orgId, {
        documentType: "general",
      }),
      "FORBIDDEN",
      "ai_request_create_not_allowed",
    );
  });

  it("cross-org actor: rejected with NOT_FOUND (no membership)", async () => {
    const s = await setup();
    await expectApiError(
      createAiRequest(prisma, s.outsider.id, s.orgId, {
        documentType: "general",
      }),
      "NOT_FOUND",
    );
  });
});

// ---------------------------------------------------------------------
// transitionAiRequestStatus
// ---------------------------------------------------------------------

describe("transitionAiRequestStatus", () => {
  it("Pending → Processing → Completed: happy lifecycle, populates timestamps and tokens", async () => {
    const s = await setup();
    const req = await createAiRequest(prisma, s.editor.id, s.orgId, {
      documentType: "general",
    });

    const inProgress = await transitionAiRequestStatus(
      prisma,
      s.editor.id,
      s.orgId,
      req.id,
      "Processing",
    );
    expect(inProgress.status).toBe("Processing");
    expect(inProgress.startedAt).not.toBeNull();
    expect(inProgress.completedAt).toBeNull();

    const done = await transitionAiRequestStatus(
      prisma,
      s.editor.id,
      s.orgId,
      req.id,
      "Completed",
      { latencyMs: 1234, tokenCountInput: 50, tokenCountOutput: 200 },
    );
    expect(done.status).toBe("Completed");
    expect(done.completedAt).not.toBeNull();
    expect(done.latencyMs).toBe(1234);
    expect(done.tokenCountInput).toBe(50);
    expect(done.tokenCountOutput).toBe(200);
  });

  it("Pending → Cancelled: allowed, records errorCode when provided", async () => {
    const s = await setup();
    const req = await createAiRequest(prisma, s.editor.id, s.orgId, {
      documentType: "general",
    });
    const cancelled = await transitionAiRequestStatus(
      prisma,
      s.editor.id,
      s.orgId,
      req.id,
      "Cancelled",
      { errorCode: "user_aborted" },
    );
    expect(cancelled.status).toBe("Cancelled");
    expect(cancelled.errorCode).toBe("user_aborted");
    expect(cancelled.completedAt).not.toBeNull();
  });

  it("Completed → Processing: rejected with CONFLICT(ai_request_status_transition_invalid)", async () => {
    const s = await setup();
    const req = await createAiRequest(prisma, s.editor.id, s.orgId, {
      documentType: "general",
    });
    await transitionAiRequestStatus(prisma, s.editor.id, s.orgId, req.id, "Processing");
    await transitionAiRequestStatus(prisma, s.editor.id, s.orgId, req.id, "Completed");
    await expectApiError(
      transitionAiRequestStatus(prisma, s.editor.id, s.orgId, req.id, "Processing"),
      "CONFLICT",
      "ai_request_status_transition_invalid",
    );
  });

  it("cross-org actor: NOT_FOUND on a foreign-org request", async () => {
    const s = await setup();
    const req = await createAiRequest(prisma, s.editor.id, s.orgId, {
      documentType: "general",
    });
    await expectApiError(
      transitionAiRequestStatus(prisma, s.outsider.id, s.outsiderOrgId, req.id, "Processing"),
      "NOT_FOUND",
    );
  });

  it("same-org non-requester (editorB): NOT_FOUND, status unchanged", async () => {
    const s = await setup();
    const req = await createAiRequest(prisma, s.editor.id, s.orgId, {
      documentType: "general",
    });
    await expectApiError(
      transitionAiRequestStatus(prisma, s.editorB.id, s.orgId, req.id, "Processing"),
      "NOT_FOUND",
    );
    const after = await prisma.aiRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(after.status).toBe("Pending");
    expect(after.startedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------
// recordAiResult
// ---------------------------------------------------------------------

describe("recordAiResult", () => {
  it("records a Generated result row with no body fields", async () => {
    const s = await setup();
    const req = await createAiRequest(prisma, s.editor.id, s.orgId, {
      documentType: "general",
    });
    const result = await recordAiResult(prisma, s.editor.id, s.orgId, req.id);
    expect(result).toMatchObject({
      aiRequestId: req.id,
      organizationId: s.orgId,
      status: "Generated",
      savedDocumentId: null,
      errorCode: null,
    });
    // The DB row truly has only the metadata columns we expect.
    const cols = Object.keys(result);
    expect(cols).not.toContain("title");
    expect(cols).not.toContain("content");
    expect(cols).not.toContain("body");
  });

  it("cross-org parent: NOT_FOUND", async () => {
    const s = await setup();
    const req = await createAiRequest(prisma, s.editor.id, s.orgId, {
      documentType: "general",
    });
    await expectApiError(
      recordAiResult(prisma, s.outsider.id, s.outsiderOrgId, req.id),
      "NOT_FOUND",
    );
  });

  it("same-org non-requester (editorB): NOT_FOUND, no row written", async () => {
    const s = await setup();
    const req = await createAiRequest(prisma, s.editor.id, s.orgId, {
      documentType: "general",
    });
    await expectApiError(
      recordAiResult(prisma, s.editorB.id, s.orgId, req.id),
      "NOT_FOUND",
    );
    const count = await prisma.aiResult.count({ where: { aiRequestId: req.id } });
    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------
// recordAiReferences
// ---------------------------------------------------------------------

describe("recordAiReferences", () => {
  it("records the audit snapshot exactly as given (accessAllowed flag honored)", async () => {
    const s = await setup();
    const req = await createAiRequest(prisma, s.editor.id, s.orgId, {
      documentType: "general",
    });
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "ref-target",
      documentType: "general",
      visibility: "Private",
    });
    const refs = await recordAiReferences(prisma, s.editor.id, s.orgId, req.id, [
      {
        targetType: "Document",
        targetId: doc.id,
        targetTitle: "ref-target",
        accessAllowed: true,
      },
    ]);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      aiRequestId: req.id,
      organizationId: s.orgId,
      targetType: "Document",
      targetId: doc.id,
      targetTitle: "ref-target",
      accessAllowed: true,
    });
  });

  it("empty list: no-op, returns []", async () => {
    const s = await setup();
    const req = await createAiRequest(prisma, s.editor.id, s.orgId, {
      documentType: "general",
    });
    const refs = await recordAiReferences(prisma, s.editor.id, s.orgId, req.id, []);
    expect(refs).toEqual([]);
  });

  it("cross-org parent: NOT_FOUND, no rows written", async () => {
    const s = await setup();
    const req = await createAiRequest(prisma, s.editor.id, s.orgId, {
      documentType: "general",
    });
    await expectApiError(
      recordAiReferences(prisma, s.outsider.id, s.outsiderOrgId, req.id, [
        {
          targetType: "Document",
          targetId: req.id, // any id, doesn't matter — call rejects before insert
          accessAllowed: false,
        },
      ]),
      "NOT_FOUND",
    );
    const count = await prisma.aiReference.count({ where: { aiRequestId: req.id } });
    expect(count).toBe(0);
  });

  it("same-org non-requester (editorB): NOT_FOUND, no rows written", async () => {
    const s = await setup();
    const req = await createAiRequest(prisma, s.editor.id, s.orgId, {
      documentType: "general",
    });
    await expectApiError(
      recordAiReferences(prisma, s.editorB.id, s.orgId, req.id, [
        {
          targetType: "Document",
          targetId: req.id,
          accessAllowed: false,
        },
      ]),
      "NOT_FOUND",
    );
    const count = await prisma.aiReference.count({ where: { aiRequestId: req.id } });
    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------
// FK + organization-boundary integrity
// ---------------------------------------------------------------------

describe("documents.ai_request_id FK to ai_requests", () => {
  it("FK rejects an ai_request_id that does not exist", async () => {
    const s = await setup();
    // Create the document first with a NULL ai_request_id, then try to
    // patch it to a bogus UUID. Postgres should reject with a FK
    // violation (Prisma P2003).
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "fk-target",
      documentType: "general",
      visibility: "Private",
    });
    await expect(
      prisma.document.update({
        where: { id: doc.id },
        data: { aiRequestId: "00000000-0000-0000-0000-000000000000" },
      }),
    ).rejects.toMatchObject({
      code: "P2003",
    });
  });

  it("FK SetNull: deleting the parent ai_requests nulls documents.ai_request_id", async () => {
    const s = await setup();
    const req = await createAiRequest(prisma, s.editor.id, s.orgId, {
      documentType: "general",
    });
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "linked",
      documentType: "general",
      visibility: "Private",
    });
    await prisma.document.update({
      where: { id: doc.id },
      data: { aiRequestId: req.id },
    });

    await prisma.aiRequest.delete({ where: { id: req.id } });
    const after = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } });
    expect(after.aiRequestId).toBeNull();
    expect(after.id).toBe(doc.id); // document survives
  });
});

describe("ai_results.ai_request_id composite FK enforces same organization", () => {
  it("rejects an ai_result with mismatched (ai_request_id, organization_id)", async () => {
    const s = await setup();
    const req = await createAiRequest(prisma, s.editor.id, s.orgId, {
      documentType: "general",
    });
    // Try to insert an ai_result where ai_request_id points at s.orgId's
    // request but organization_id is the outsider org. The composite FK
    // on (ai_request_id, organization_id) → ai_requests(id, organization_id)
    // should make Postgres reject this.
    await expect(
      prisma.aiResult.create({
        data: {
          id: undefined as unknown as string, // let Prisma default
          aiRequestId: req.id,
          organizationId: s.outsiderOrgId,
          status: "Generated",
        },
      }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });
});

describe("ai_results.saved_document_id composite FK enforces same organization", () => {
  it("same-org saved document link succeeds", async () => {
    const s = await setup();
    const req = await createAiRequest(prisma, s.editor.id, s.orgId, {
      documentType: "general",
    });
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "saved",
      documentType: "general",
      visibility: "Private",
    });
    const result = await recordAiResult(prisma, s.editor.id, s.orgId, req.id);
    const linked = await prisma.aiResult.update({
      where: { id: result.id },
      data: { savedDocumentId: doc.id, status: "Saved" },
    });
    expect(linked.savedDocumentId).toBe(doc.id);
    expect(linked.status).toBe("Saved");
  });

  it("rejects an ai_result whose saved_document_id belongs to a different organization", async () => {
    const s = await setup();
    // Build a document owned by the outsider org.
    const outsiderDoc = await createDocument(prisma, s.outsider.id, s.outsiderOrgId, {
      title: "foreign",
      documentType: "general",
      visibility: "Private",
    });
    const req = await createAiRequest(prisma, s.editor.id, s.orgId, {
      documentType: "general",
    });
    const result = await recordAiResult(prisma, s.editor.id, s.orgId, req.id);
    // saved_document_id points at the outsider org's document but the
    // ai_result still carries s.orgId — the composite FK on
    // (saved_document_id, organization_id) → documents(id, organization_id)
    // should reject this.
    await expect(
      prisma.aiResult.update({
        where: { id: result.id },
        data: { savedDocumentId: outsiderDoc.id },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });
});
