// Phase C step 5 — document version history / restore integration tests.
//
// Pins the policies the Step 5 service surface implements:
//
//   - createDocument writes version #1 atomically with the document
//     row. organization_id is propagated from the parent so the
//     composite FK never sees a mismatch.
//   - updateDocument writes a new version when title / content /
//     documentType change. visibility / ownerTeamId / status-only
//     changes do NOT create a version.
//   - listDocumentVersions / getDocumentVersion need View. Restore
//     needs Edit. Cross-org / Deleted documents are NOT_FOUND for
//     every entry point, including for the owner.
//   - Admin gets no implicit body access — same path as Step 2.
//   - Restore sets the document's title/content to the chosen
//     snapshot but preserves status. The original version row is
//     unchanged; restore writes a new version row whose
//     changeSummary records "restored from version N".
//   - DOCUMENT_VERSION_RESTORED is recorded with metadata that
//     includes the source versionId / number and the new versionNumber.
//   - versionNumber increments per document, not globally.

import { describe, expect, it } from "vitest";

import { prisma } from "@notive/db";
import { ApiError } from "@notive/permissions";

import {
  createDocument,
  deleteDocument,
  updateDocument,
} from "../../apps/web/lib/services/document";
import {
  getDocumentVersion,
  listDocumentVersions,
  restoreDocumentVersion,
} from "../../apps/web/lib/services/document-version";

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
  const orgId = await createOrganization(admin.id, "ver-org");
  await createMembership({
    userId: admin.id,
    organizationId: orgId,
    role: "Admin",
    status: "Active",
  });

  const teamA = await createTeam(orgId, "team-a");

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
    teamId: teamA,
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
  const outsiderOrgId = await createOrganization(outsider.id, "outside-ver-org");
  await createMembership({
    userId: outsider.id,
    organizationId: outsiderOrgId,
    role: "Admin",
    status: "Active",
  });

  return { orgId, teamA, admin, manager, editor, editorB, viewer, outsiderOrgId, outsider };
}

// ---------------------------------------------------------------------
// Version creation on create / update
// ---------------------------------------------------------------------

describe("version creation hooks", () => {
  it("createDocument writes version #1 with snapshot of initial title/content and matching organization_id", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "v1 title",
      content: "v1 body",
      documentType: "general",
    });
    const versions = await prisma.documentVersion.findMany({
      where: { documentId: doc.id },
      orderBy: { versionNumber: "asc" },
    });
    expect(versions).toHaveLength(1);
    expect(versions[0]!.versionNumber).toBe(1);
    expect(versions[0]!.titleSnapshot).toBe("v1 title");
    expect(versions[0]!.contentSnapshot).toBe("v1 body");
    expect(versions[0]!.changedByUserId).toBe(s.editor.id);
    expect(versions[0]!.changeSummary).toBe("initial");
    // organization_id must equal the document's, enforced by helper +
    // composite FK.
    expect(versions[0]!.organizationId).toBe(doc.organizationId);
  });

  it("updateDocument with title/content change creates a new version", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "v1",
      content: "body1",
      documentType: "general",
    });
    await updateDocument(prisma, s.editor.id, s.orgId, doc.id, {
      title: "v2",
      content: "body2",
    });
    const versions = await prisma.documentVersion.findMany({
      where: { documentId: doc.id },
      orderBy: { versionNumber: "asc" },
    });
    expect(versions).toHaveLength(2);
    expect(versions[1]!.titleSnapshot).toBe("v2");
    expect(versions[1]!.contentSnapshot).toBe("body2");
    expect(versions[1]!.versionNumber).toBe(2);
  });

  it("updateDocument with documentType-only change creates a new version", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "t",
      content: "c",
      documentType: "general",
    });
    await updateDocument(prisma, s.editor.id, s.orgId, doc.id, {
      documentType: "report",
    });
    const versions = await prisma.documentVersion.findMany({
      where: { documentId: doc.id },
    });
    expect(versions).toHaveLength(2);
  });

  it("updateDocument with visibility-only change does NOT create a new version", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "t",
      documentType: "general",
    });
    await updateDocument(prisma, s.editor.id, s.orgId, doc.id, {
      visibility: "Organization",
    });
    const versions = await prisma.documentVersion.findMany({
      where: { documentId: doc.id },
    });
    expect(versions).toHaveLength(1);
  });

  it("updateDocument with status=Archived only does NOT create a new version", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "t",
      documentType: "general",
    });
    await updateDocument(prisma, s.editor.id, s.orgId, doc.id, {
      status: "Archived",
    });
    const versions = await prisma.documentVersion.findMany({
      where: { documentId: doc.id },
    });
    expect(versions).toHaveLength(1);
  });

  it("versionNumber increments per document, not globally", async () => {
    const s = await setup();
    const a = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "A1",
      documentType: "general",
    });
    const b = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "B1",
      documentType: "general",
    });
    await updateDocument(prisma, s.editor.id, s.orgId, a.id, { title: "A2" });
    await updateDocument(prisma, s.editor.id, s.orgId, b.id, { title: "B2" });
    await updateDocument(prisma, s.editor.id, s.orgId, a.id, { title: "A3" });

    const aVers = await prisma.documentVersion.findMany({
      where: { documentId: a.id },
      orderBy: { versionNumber: "asc" },
    });
    const bVers = await prisma.documentVersion.findMany({
      where: { documentId: b.id },
      orderBy: { versionNumber: "asc" },
    });
    expect(aVers.map((v) => v.versionNumber)).toEqual([1, 2, 3]);
    expect(bVers.map((v) => v.versionNumber)).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------
// list / preview permission gate
// ---------------------------------------------------------------------

describe("listDocumentVersions / getDocumentVersion permission", () => {
  it("View permission is enough to list and preview versions", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "v1",
      documentType: "general",
      visibility: "Organization",
    });
    await updateDocument(prisma, s.editor.id, s.orgId, doc.id, { title: "v2" });

    const list = await listDocumentVersions(prisma, s.editorB.id, s.orgId, doc.id);
    expect(list).toHaveLength(2);
    // ordered newest-first
    expect(list[0]!.versionNumber).toBe(2);

    const v1 = list.find((v) => v.versionNumber === 1)!;
    const fetched = await getDocumentVersion(prisma, s.editorB.id, s.orgId, doc.id, v1.id);
    expect(fetched.titleSnapshot).toBe("v1");
  });

  it("no-view actor on a Private doc gets NOT_FOUND on list and preview", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "secret",
      documentType: "general",
      visibility: "Private",
    });
    await expectApiError(
      listDocumentVersions(prisma, s.editorB.id, s.orgId, doc.id),
      "NOT_FOUND",
      null,
    );
    // editorB also does not know any version id, but if they guess one...
    const realVersion = await prisma.documentVersion.findFirst({
      where: { documentId: doc.id },
    });
    await expectApiError(
      getDocumentVersion(prisma, s.editorB.id, s.orgId, doc.id, realVersion!.id),
      "NOT_FOUND",
      null,
    );
  });

  it("Admin without explicit grant on a Private doc gets NOT_FOUND on versions", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "private",
      documentType: "general",
      visibility: "Private",
    });
    await expectApiError(
      listDocumentVersions(prisma, s.admin.id, s.orgId, doc.id),
      "NOT_FOUND",
      null,
    );
  });

  it("cross-org documentId -> NOT_FOUND for list, preview, and restore", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "x",
      documentType: "general",
    });
    const realVersion = await prisma.documentVersion.findFirst({
      where: { documentId: doc.id },
    });
    await expectApiError(
      listDocumentVersions(prisma, s.outsider.id, s.outsiderOrgId, doc.id),
      "NOT_FOUND",
      null,
    );
    await expectApiError(
      getDocumentVersion(prisma, s.outsider.id, s.outsiderOrgId, doc.id, realVersion!.id),
      "NOT_FOUND",
      null,
    );
    await expectApiError(
      restoreDocumentVersion(prisma, s.outsider.id, s.outsiderOrgId, doc.id, realVersion!.id),
      "NOT_FOUND",
      null,
    );
  });

  it("versionId belonging to another document or org -> NOT_FOUND on preview and restore", async () => {
    const s = await setup();
    const docA = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "A",
      documentType: "general",
    });
    const docB = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "B",
      documentType: "general",
    });
    const aVer = await prisma.documentVersion.findFirst({
      where: { documentId: docA.id },
    });
    // Trying to fetch docA's version under docB id is NOT_FOUND.
    await expectApiError(
      getDocumentVersion(prisma, s.editor.id, s.orgId, docB.id, aVer!.id),
      "NOT_FOUND",
      null,
    );
    await expectApiError(
      restoreDocumentVersion(prisma, s.editor.id, s.orgId, docB.id, aVer!.id),
      "NOT_FOUND",
      null,
    );
  });

  it("Deleted document -> NOT_FOUND on list, preview, and restore", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "to be deleted",
      documentType: "general",
    });
    const ver = await prisma.documentVersion.findFirst({
      where: { documentId: doc.id },
    });
    await deleteDocument(prisma, s.editor.id, s.orgId, doc.id);

    await expectApiError(
      listDocumentVersions(prisma, s.editor.id, s.orgId, doc.id),
      "NOT_FOUND",
      null,
    );
    await expectApiError(
      getDocumentVersion(prisma, s.editor.id, s.orgId, doc.id, ver!.id),
      "NOT_FOUND",
      null,
    );
    await expectApiError(
      restoreDocumentVersion(prisma, s.editor.id, s.orgId, doc.id, ver!.id),
      "NOT_FOUND",
      null,
    );
  });
});

// ---------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------

describe("restoreDocumentVersion", () => {
  it("Edit permission is required; View-only viewer gets FORBIDDEN(document_edit_not_allowed)", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "v1",
      content: "body1",
      documentType: "general",
      visibility: "Organization",
    });
    await updateDocument(prisma, s.editor.id, s.orgId, doc.id, {
      title: "v2",
      content: "body2",
    });
    const v1 = await prisma.documentVersion.findFirst({
      where: { documentId: doc.id, versionNumber: 1 },
    });
    // Org-public gives editorB View only — not Edit.
    await expectApiError(
      restoreDocumentVersion(prisma, s.editorB.id, s.orgId, doc.id, v1!.id),
      "FORBIDDEN",
      "document_edit_not_allowed",
    );
  });

  it("Owner can restore. Document body returns to the snapshot; status is preserved.", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "v1",
      content: "body1",
      documentType: "general",
    });
    await updateDocument(prisma, s.editor.id, s.orgId, doc.id, {
      title: "v2",
      content: "body2",
    });
    // Archive the document — restore must NOT flip back to Active.
    await updateDocument(prisma, s.editor.id, s.orgId, doc.id, {
      status: "Archived",
    });
    const v1 = await prisma.documentVersion.findFirst({
      where: { documentId: doc.id, versionNumber: 1 },
    });

    const result = await restoreDocumentVersion(prisma, s.editor.id, s.orgId, doc.id, v1!.id);
    expect(result.document.title).toBe("v1");
    expect(result.document.content).toBe("body1");
    expect(result.document.status).toBe("Archived"); // preserved

    // Original v1 row is unchanged.
    const v1AfterRestore = await prisma.documentVersion.findUnique({
      where: { id: v1!.id },
    });
    expect(v1AfterRestore!.titleSnapshot).toBe("v1");
    expect(v1AfterRestore!.contentSnapshot).toBe("body1");

    // A NEW version row exists for the restore.
    expect(result.newVersion.versionNumber).toBe(3);
    expect(result.newVersion.titleSnapshot).toBe("v1");
    expect(result.newVersion.contentSnapshot).toBe("body1");
    expect(result.newVersion.changeSummary).toBe("restored from version 1");
  });

  it("audit: restore writes DOCUMENT_VERSION_RESTORED with source/new version metadata", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "v1",
      documentType: "general",
    });
    await updateDocument(prisma, s.editor.id, s.orgId, doc.id, { title: "v2" });
    const v1 = await prisma.documentVersion.findFirst({
      where: { documentId: doc.id, versionNumber: 1 },
    });
    const result = await restoreDocumentVersion(prisma, s.editor.id, s.orgId, doc.id, v1!.id);

    const log = await prisma.activityLog.findFirst({
      where: { action: "document.version_restored", targetId: doc.id },
      orderBy: { createdAt: "desc" },
    });
    expect(log).not.toBeNull();
    expect(log!.actorUserId).toBe(s.editor.id);
    expect(log!.targetType).toBe("document");
    const meta = log!.metadata as {
      restoredFromVersionId: string;
      restoredFromVersionNumber: number;
      newVersionNumber: number;
    } | null;
    expect(meta).toEqual({
      restoredFromVersionId: v1!.id,
      restoredFromVersionNumber: 1,
      newVersionNumber: result.newVersion.versionNumber,
    });
  });
});
