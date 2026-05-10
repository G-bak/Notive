// Phase C step 3 — document service integration tests.
//
// Drives the service functions in apps/web/lib/services/document
// directly (no Next.js boot) so we can assert DB state precisely. The
// test scenarios pin the policies that Phase C plan §15.1–§15.4 mark
// as CI-gated.
//
// What is asserted:
//   - role gating on create (Viewer cannot create)
//   - listing only returns documents the actor can view
//   - cross-org / Private / SpecificUsers / Manager / author paths all
//     map to the right View / Edit / Manage answers
//   - update needs Edit (Manage when changing visibility / ownership /
//     archiving), delete needs Manage
//   - DELETE is a soft delete — row stays, status=Deleted, deletedAt
//     set, and the document is hidden from list / get afterwards
//   - every successful mutation writes an activity_logs row through
//     the Phase B audit writer skeleton
//
// Documents are created and queried via the service layer (no HTTP),
// keeping the test focused on the policy + DB integration rather than
// the route framing.

import { describe, expect, it } from "vitest";

import { prisma } from "@notive/db";
import { ApiError } from "@notive/permissions";

import {
  createDocument,
  deleteDocument,
  getDocument,
  listDocuments,
  updateDocument,
} from "../../apps/web/lib/services/document";

import { createMembership, createOrganization, createTeam, createUser } from "./src/helpers.js";

interface UserRow {
  id: string;
}

async function expectApiError(
  promise: Promise<unknown>,
  code: ApiError["code"],
  reason?: string | null,
): Promise<void> {
  await expect(promise).rejects.toMatchObject(reason !== undefined ? { code, reason } : { code });
}

interface BasicSetup {
  orgId: string;
  teamA: string;
  teamB: string;
  admin: UserRow;
  manager: UserRow;
  editor: UserRow;
  editorB: UserRow;
  viewer: UserRow;
  outsiderOrgId: string;
  outsider: UserRow;
}

async function setup(): Promise<BasicSetup> {
  const admin = await createUser("admin");
  const orgId = await createOrganization(admin.id, "doc-org");
  await createMembership({
    userId: admin.id,
    organizationId: orgId,
    role: "Admin",
    status: "Active",
  });

  const teamA = await createTeam(orgId, "team-a");
  const teamB = await createTeam(orgId, "team-b");

  const manager = await createUser("manager");
  await createMembership({
    userId: manager.id,
    organizationId: orgId,
    teamId: teamA,
    role: "Manager",
    status: "Active",
  });

  const editor = await createUser("editor");
  await createMembership({
    userId: editor.id,
    organizationId: orgId,
    teamId: teamA,
    role: "Editor",
    status: "Active",
  });

  const editorB = await createUser("editorB");
  await createMembership({
    userId: editorB.id,
    organizationId: orgId,
    teamId: teamB,
    role: "Editor",
    status: "Active",
  });

  const viewer = await createUser("viewer");
  await createMembership({
    userId: viewer.id,
    organizationId: orgId,
    teamId: teamA,
    role: "Viewer",
    status: "Active",
  });

  const outsider = await createUser("outsider");
  const outsiderOrgId = await createOrganization(outsider.id, "outside-org");
  await createMembership({
    userId: outsider.id,
    organizationId: outsiderOrgId,
    role: "Admin",
    status: "Active",
  });

  return { orgId, teamA, teamB, admin, manager, editor, editorB, viewer, outsiderOrgId, outsider };
}

// ---------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------

describe("createDocument", () => {
  it("Editor can create a document; defaults to Private + Draft + actor's primary team", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "My doc",
      documentType: "general",
    });
    expect(doc.title).toBe("My doc");
    expect(doc.status).toBe("Draft");
    expect(doc.visibility).toBe("Private");
    expect(doc.ownerUserId).toBe(s.editor.id);
    expect(doc.authorUserId).toBe(s.editor.id);
    expect(doc.ownerTeamId).toBe(s.teamA);
    expect(doc.organizationId).toBe(s.orgId);
  });

  it("Manager can create a document", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.manager.id, s.orgId, {
      title: "By manager",
      documentType: "report",
    });
    expect(doc.ownerUserId).toBe(s.manager.id);
  });

  it("Admin can create a document", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.admin.id, s.orgId, {
      title: "By admin",
      documentType: "general",
    });
    expect(doc.ownerUserId).toBe(s.admin.id);
  });

  it("Viewer cannot create — FORBIDDEN(document_create_not_allowed)", async () => {
    const s = await setup();
    await expectApiError(
      createDocument(prisma, s.viewer.id, s.orgId, {
        title: "nope",
        documentType: "general",
      }),
      "FORBIDDEN",
      "document_create_not_allowed",
    );
  });

  it("Cross-org create attempt -> NOT_FOUND (no membership in target org)", async () => {
    const s = await setup();
    await expectApiError(
      createDocument(prisma, s.outsider.id, s.orgId, {
        title: "x",
        documentType: "general",
      }),
      "NOT_FOUND",
      null,
    );
  });

  it("invalid input -> INVALID_INPUT", async () => {
    const s = await setup();
    await expectApiError(
      createDocument(prisma, s.editor.id, s.orgId, { title: "", documentType: "general" }),
      "INVALID_INPUT",
    );
  });

  it("create writes a DOCUMENT_CREATED activity log row", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "Audit me",
      documentType: "general",
    });
    const log = await prisma.activityLog.findFirst({
      where: { action: "document.created", targetId: doc.id },
    });
    expect(log).not.toBeNull();
    expect(log!.organizationId).toBe(s.orgId);
    expect(log!.actorUserId).toBe(s.editor.id);
    expect(log!.targetType).toBe("document");
    expect(log!.result).toBe("Success");
  });
});

// ---------------------------------------------------------------------
// Get / list — visibility + permission
// ---------------------------------------------------------------------

describe("getDocument and listDocuments", () => {
  it("Owner sees their own Private document with Manage", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "mine",
      documentType: "general",
    });
    const result = await getDocument(prisma, s.editor.id, s.orgId, doc.id);
    expect(result.permission).toBe("Manage");
    expect(result.document.id).toBe(doc.id);
  });

  it("Private document is NOT_FOUND for a non-owner without a share, even for Admin", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "secret",
      documentType: "general",
      visibility: "Private",
    });
    await expectApiError(getDocument(prisma, s.admin.id, s.orgId, doc.id), "NOT_FOUND", null);
    await expectApiError(getDocument(prisma, s.editorB.id, s.orgId, doc.id), "NOT_FOUND", null);
  });

  it("cross-org direct ID access -> NOT_FOUND", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "private",
      documentType: "general",
    });
    // outsider tries to fetch our doc id via the outsider's own org
    // membership — no leak.
    await expectApiError(
      getDocument(prisma, s.outsider.id, s.outsiderOrgId, doc.id),
      "NOT_FOUND",
      null,
    );
  });

  it("Manager has Manage on Team-visible documents owned by their team", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "team thing",
      documentType: "general",
      visibility: "Team",
    });
    expect(doc.ownerTeamId).toBe(s.teamA);
    const result = await getDocument(prisma, s.manager.id, s.orgId, doc.id);
    expect(result.permission).toBe("Manage");
  });

  it("Manager does NOT auto-access Private documents owned by their team — share/ownership is required", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "team-private",
      documentType: "general",
      visibility: "Private",
    });
    expect(doc.ownerTeamId).toBe(s.teamA);
    await expectApiError(getDocument(prisma, s.manager.id, s.orgId, doc.id), "NOT_FOUND", null);
  });

  it("author (separate from owner) sees View, but not Edit", async () => {
    const s = await setup();
    // editor creates a private doc, then we manually flip the owner to
    // someone else so author != owner.
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "auth/owner split",
      documentType: "general",
      visibility: "Private",
    });
    await prisma.document.update({
      where: { id: doc.id },
      data: { ownerUserId: s.editorB.id },
    });

    const view = await getDocument(prisma, s.editor.id, s.orgId, doc.id);
    expect(view.permission).toBe("View");

    await expectApiError(
      updateDocument(prisma, s.editor.id, s.orgId, doc.id, { title: "rename" }),
      "FORBIDDEN",
      "document_edit_not_allowed",
    );
  });

  it("listDocuments returns only documents the actor can view, ordered by updatedAt desc", async () => {
    const s = await setup();
    const myDoc = await createDocument(prisma, s.editorB.id, s.orgId, {
      title: "my private",
      documentType: "general",
      visibility: "Private",
    });
    const orgDoc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "org public",
      documentType: "general",
      visibility: "Organization",
    });
    const teamADoc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "team a",
      documentType: "general",
      visibility: "Team",
    });
    // editorB lives in teamB, so the teamA team-visible doc is hidden.
    const visible = await listDocuments(prisma, s.editorB.id, s.orgId);
    const ids = visible.map((d) => d.id).sort();
    expect(ids).toEqual([myDoc.id, orgDoc.id].sort());
    expect(ids).not.toContain(teamADoc.id);
  });

  it("listDocuments excludes Deleted documents from everyone (even the owner)", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "to be deleted",
      documentType: "general",
      visibility: "Organization",
    });
    await deleteDocument(prisma, s.editor.id, s.orgId, doc.id);
    const visible = await listDocuments(prisma, s.editor.id, s.orgId);
    expect(visible.find((d) => d.id === doc.id)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------

describe("updateDocument", () => {
  it("Owner (Manage) can update title/content", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "v1",
      documentType: "general",
    });
    const updated = await updateDocument(prisma, s.editor.id, s.orgId, doc.id, {
      title: "v2",
      content: "hello",
    });
    expect(updated.title).toBe("v2");
    expect(updated.content).toBe("hello");
  });

  it("Editor with View-only access cannot update — FORBIDDEN(document_edit_not_allowed)", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "org doc",
      documentType: "general",
      visibility: "Organization",
    });
    // editorB has only the Organization-derived View grant
    await expectApiError(
      updateDocument(prisma, s.editorB.id, s.orgId, doc.id, { title: "nope" }),
      "FORBIDDEN",
      "document_edit_not_allowed",
    );
  });

  it("Non-viewer update attempt -> NOT_FOUND (Phase A §15: no existence leak)", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "private",
      documentType: "general",
      visibility: "Private",
    });
    await expectApiError(
      updateDocument(prisma, s.editorB.id, s.orgId, doc.id, { title: "nope" }),
      "NOT_FOUND",
      null,
    );
  });

  it("Editor (with Edit grant) cannot change visibility — Manage required", async () => {
    const s = await setup();
    // Owner-editor creates org-public, then shares Edit with editorB.
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "shared",
      documentType: "general",
      visibility: "Private",
    });
    await prisma.documentShare.create({
      data: {
        documentId: doc.id,
        organizationId: s.orgId,
        targetType: "User",
        targetId: s.editorB.id,
        permission: "Edit",
        createdByUserId: s.editor.id,
      },
    });
    // editorB has Edit; can change content.
    await updateDocument(prisma, s.editorB.id, s.orgId, doc.id, { content: "edited" });
    // editorB cannot change visibility (Manage-only field).
    await expectApiError(
      updateDocument(prisma, s.editorB.id, s.orgId, doc.id, { visibility: "Organization" }),
      "FORBIDDEN",
      "document_manage_not_allowed",
    );
  });

  it("Owner can archive via PATCH status=Archived (Manage path)", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "archive me",
      documentType: "general",
    });
    const archived = await updateDocument(prisma, s.editor.id, s.orgId, doc.id, {
      status: "Archived",
    });
    expect(archived.status).toBe("Archived");
  });

  it("update writes a DOCUMENT_UPDATED activity log row with changed fields", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "v1",
      documentType: "general",
    });
    await updateDocument(prisma, s.editor.id, s.orgId, doc.id, {
      title: "v2",
      content: "body",
    });
    const log = await prisma.activityLog.findFirst({
      where: { action: "document.updated", targetId: doc.id },
      orderBy: { createdAt: "desc" },
    });
    expect(log).not.toBeNull();
    const meta = log!.metadata as { changed?: string[] } | null;
    expect(meta?.changed).toEqual(["title", "content"]);
  });
});

// ---------------------------------------------------------------------
// Delete (soft)
// ---------------------------------------------------------------------

describe("deleteDocument (soft delete)", () => {
  it("Owner (Manage) can soft-delete; row remains with status=Deleted and deletedAt set", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "bye",
      documentType: "general",
    });
    const deleted = await deleteDocument(prisma, s.editor.id, s.orgId, doc.id);
    expect(deleted.status).toBe("Deleted");
    expect(deleted.deletedAt).not.toBeNull();
    const stillExists = await prisma.document.findUnique({ where: { id: doc.id } });
    expect(stillExists).not.toBeNull();
    expect(stillExists!.status).toBe("Deleted");
  });

  it("Editor with only Edit share cannot delete — FORBIDDEN(document_manage_not_allowed)", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "shared",
      documentType: "general",
      visibility: "Private",
    });
    await prisma.documentShare.create({
      data: {
        documentId: doc.id,
        organizationId: s.orgId,
        targetType: "User",
        targetId: s.editorB.id,
        permission: "Edit",
        createdByUserId: s.editor.id,
      },
    });
    await expectApiError(
      deleteDocument(prisma, s.editorB.id, s.orgId, doc.id),
      "FORBIDDEN",
      "document_manage_not_allowed",
    );
  });

  it("Non-viewer delete attempt -> NOT_FOUND", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "private",
      documentType: "general",
      visibility: "Private",
    });
    await expectApiError(deleteDocument(prisma, s.editorB.id, s.orgId, doc.id), "NOT_FOUND", null);
  });

  it("Deleted document is NOT_FOUND on getDocument afterward", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "x",
      documentType: "general",
      visibility: "Organization",
    });
    await deleteDocument(prisma, s.editor.id, s.orgId, doc.id);
    await expectApiError(getDocument(prisma, s.editor.id, s.orgId, doc.id), "NOT_FOUND", null);
  });

  it("second delete on an already-Deleted document is NOT_FOUND (no row leak through DELETE)", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "x",
      documentType: "general",
    });
    await deleteDocument(prisma, s.editor.id, s.orgId, doc.id);
    // Even the original owner gets NOT_FOUND on a re-delete — the row
    // is no longer reachable via any read path, including DELETE.
    await expectApiError(deleteDocument(prisma, s.editor.id, s.orgId, doc.id), "NOT_FOUND", null);
  });

  it("an unrelated org member who guesses a Deleted document id gets NOT_FOUND on DELETE — no body / metadata leak", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "secret then deleted",
      documentType: "general",
      visibility: "Private",
    });
    await deleteDocument(prisma, s.editor.id, s.orgId, doc.id);
    // editorB never had any view permission on this Private doc, and
    // it is now soft-deleted. Hitting DELETE must be NOT_FOUND with no
    // reason_code so the response cannot be used to confirm that the
    // id ever existed.
    await expectApiError(deleteDocument(prisma, s.editorB.id, s.orgId, doc.id), "NOT_FOUND", null);
  });

  it("delete writes a DOCUMENT_DELETED activity log row", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "audit-delete",
      documentType: "general",
    });
    await deleteDocument(prisma, s.editor.id, s.orgId, doc.id);
    const log = await prisma.activityLog.findFirst({
      where: { action: "document.deleted", targetId: doc.id },
    });
    expect(log).not.toBeNull();
    expect(log!.actorUserId).toBe(s.editor.id);
    expect(log!.targetType).toBe("document");
  });
});
