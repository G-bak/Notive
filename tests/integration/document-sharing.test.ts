// Phase C step 4 — document sharing API integration tests.
//
// Pins the policies the Step 4 service / route surface implements:
//
//   - Manage permission required for both list AND replace.
//   - Deleted documents are NOT_FOUND for everyone (Step 3 closure).
//   - Cross-org document id is NOT_FOUND.
//   - Admin has no implicit body / share access on Private docs.
//   - Manager auto-Manage applies only on visibility=Team owned by
//     the actor's primary team (Step 2 narrow scope).
//   - Manage-share recipient can read / replace shares.
//   - Edit-share recipient cannot.
//   - target validation: User / Team / Organization checked against
//     the document's organization. Cross-org targets are NOT_FOUND.
//   - duplicate (targetType, targetId) entries are INVALID_INPUT.
//   - PUT is replace-all: pre-existing shares not in the new payload
//     are removed; new entries are inserted; existing entries with a
//     changed permission are updated. Audit metadata captures the
//     diff.
//
// Service is driven directly (no Next.js boot), matching the Step 3
// integration suite style.

import { describe, expect, it } from "vitest";

import { prisma } from "@notive/db";
import { ApiError } from "@notive/permissions";

import { createDocument, deleteDocument } from "../../apps/web/lib/services/document";
import {
  listDocumentShares,
  replaceDocumentShares,
} from "../../apps/web/lib/services/document-share";

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
  const orgId = await createOrganization(admin.id, "share-org");
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
  const outsiderOrgId = await createOrganization(outsider.id, "outside-share-org");
  await createMembership({
    userId: outsider.id,
    organizationId: outsiderOrgId,
    role: "Admin",
    status: "Active",
  });

  return { orgId, teamA, teamB, admin, manager, editor, editorB, viewer, outsiderOrgId, outsider };
}

// ---------------------------------------------------------------------
// Manage permission for list / replace
// ---------------------------------------------------------------------

describe("document share permission gate", () => {
  it("Owner can list and replace shares (Manage from ownership)", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "owner",
      documentType: "general",
    });
    const shares = await listDocumentShares(prisma, s.editor.id, s.orgId, doc.id);
    expect(shares).toEqual([]);
    const updated = await replaceDocumentShares(prisma, s.editor.id, s.orgId, doc.id, {
      shares: [{ targetType: "User", targetId: s.editorB.id, permission: "View" }],
    });
    expect(updated).toHaveLength(1);
    expect(updated[0]!.permission).toBe("View");
  });

  it("Manager has Manage on Team-visible team docs and can replace shares", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "team",
      documentType: "general",
      visibility: "Team",
    });
    const updated = await replaceDocumentShares(prisma, s.manager.id, s.orgId, doc.id, {
      shares: [{ targetType: "User", targetId: s.editorB.id, permission: "Edit" }],
    });
    expect(updated).toHaveLength(1);
  });

  it("Manage-share recipient can list and replace shares", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "shared mgr",
      documentType: "general",
      visibility: "Private",
    });
    await prisma.documentShare.create({
      data: {
        documentId: doc.id,
        organizationId: s.orgId,
        targetType: "User",
        targetId: s.editorB.id,
        permission: "Manage",
        createdByUserId: s.editor.id,
      },
    });
    const list = await listDocumentShares(prisma, s.editorB.id, s.orgId, doc.id);
    expect(list).toHaveLength(1);
    // editorB can also rewrite the list — including their own row.
    const updated = await replaceDocumentShares(prisma, s.editorB.id, s.orgId, doc.id, {
      shares: [
        { targetType: "User", targetId: s.editorB.id, permission: "Manage" },
        { targetType: "User", targetId: s.viewer.id, permission: "View" },
      ],
    });
    expect(updated).toHaveLength(2);
  });

  it("Edit-share recipient cannot list shares — FORBIDDEN(document_manage_not_allowed)", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "edit only",
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
      listDocumentShares(prisma, s.editorB.id, s.orgId, doc.id),
      "FORBIDDEN",
      "document_manage_not_allowed",
    );
    await expectApiError(
      replaceDocumentShares(prisma, s.editorB.id, s.orgId, doc.id, { shares: [] }),
      "FORBIDDEN",
      "document_manage_not_allowed",
    );
  });

  it("View-only viewer (Org-public doc) cannot read shares — FORBIDDEN(document_manage_not_allowed)", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "org-pub",
      documentType: "general",
      visibility: "Organization",
    });
    await expectApiError(
      listDocumentShares(prisma, s.editorB.id, s.orgId, doc.id),
      "FORBIDDEN",
      "document_manage_not_allowed",
    );
  });

  it("Admin without explicit grant gets NOT_FOUND on a Private document — no implicit share access", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "private",
      documentType: "general",
      visibility: "Private",
    });
    await expectApiError(
      listDocumentShares(prisma, s.admin.id, s.orgId, doc.id),
      "NOT_FOUND",
      null,
    );
    await expectApiError(
      replaceDocumentShares(prisma, s.admin.id, s.orgId, doc.id, { shares: [] }),
      "NOT_FOUND",
      null,
    );
  });

  it("cross-org document id -> NOT_FOUND on both list and replace", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "private",
      documentType: "general",
    });
    await expectApiError(
      listDocumentShares(prisma, s.outsider.id, s.outsiderOrgId, doc.id),
      "NOT_FOUND",
      null,
    );
    await expectApiError(
      replaceDocumentShares(prisma, s.outsider.id, s.outsiderOrgId, doc.id, { shares: [] }),
      "NOT_FOUND",
      null,
    );
  });

  it("Deleted document -> NOT_FOUND for both list and replace, even for the owner", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "to be deleted",
      documentType: "general",
    });
    await deleteDocument(prisma, s.editor.id, s.orgId, doc.id);
    await expectApiError(
      listDocumentShares(prisma, s.editor.id, s.orgId, doc.id),
      "NOT_FOUND",
      null,
    );
    await expectApiError(
      replaceDocumentShares(prisma, s.editor.id, s.orgId, doc.id, { shares: [] }),
      "NOT_FOUND",
      null,
    );
  });
});

// ---------------------------------------------------------------------
// Target validation
// ---------------------------------------------------------------------

describe("share target validation", () => {
  it("User target who is not a member of this org -> NOT_FOUND", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "x",
      documentType: "general",
    });
    await expectApiError(
      replaceDocumentShares(prisma, s.editor.id, s.orgId, doc.id, {
        shares: [{ targetType: "User", targetId: s.outsider.id, permission: "View" }],
      }),
      "NOT_FOUND",
      null,
    );
  });

  it("Team target from another org -> NOT_FOUND", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "x",
      documentType: "general",
    });
    // create a team in the outsider org
    const outsiderTeamId = await createTeam(s.outsiderOrgId, "outside-team");
    await expectApiError(
      replaceDocumentShares(prisma, s.editor.id, s.orgId, doc.id, {
        shares: [{ targetType: "Team", targetId: outsiderTeamId, permission: "View" }],
      }),
      "NOT_FOUND",
      null,
    );
  });

  it("Organization target with a different organizationId -> NOT_FOUND", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "x",
      documentType: "general",
    });
    await expectApiError(
      replaceDocumentShares(prisma, s.editor.id, s.orgId, doc.id, {
        shares: [{ targetType: "Organization", targetId: s.outsiderOrgId, permission: "View" }],
      }),
      "NOT_FOUND",
      null,
    );
  });

  it("Organization target with the document's own organizationId -> accepted", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "x",
      documentType: "general",
    });
    const updated = await replaceDocumentShares(prisma, s.editor.id, s.orgId, doc.id, {
      shares: [{ targetType: "Organization", targetId: s.orgId, permission: "Edit" }],
    });
    expect(updated).toHaveLength(1);
    expect(updated[0]!.targetType).toBe("Organization");
    expect(updated[0]!.targetId).toBe(s.orgId);
  });

  it("duplicate (targetType, targetId) entries -> INVALID_INPUT", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "x",
      documentType: "general",
    });
    await expectApiError(
      replaceDocumentShares(prisma, s.editor.id, s.orgId, doc.id, {
        shares: [
          { targetType: "User", targetId: s.editorB.id, permission: "View" },
          { targetType: "User", targetId: s.editorB.id, permission: "Edit" },
        ],
      }),
      "INVALID_INPUT",
    );
  });

  it("invalid targetType (e.g. Department) -> INVALID_INPUT", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "x",
      documentType: "general",
    });
    await expectApiError(
      replaceDocumentShares(prisma, s.editor.id, s.orgId, doc.id, {
        shares: [{ targetType: "Department", targetId: s.teamA, permission: "View" }],
      }),
      "INVALID_INPUT",
    );
  });
});

// ---------------------------------------------------------------------
// Replace-all semantics + audit
// ---------------------------------------------------------------------

describe("replace-all semantics and audit", () => {
  it("PUT replaces the share set: pre-existing-not-in-new are removed, new ones added, changed permissions updated", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "x",
      documentType: "general",
    });
    // initial set: editorB View, viewer View
    await replaceDocumentShares(prisma, s.editor.id, s.orgId, doc.id, {
      shares: [
        { targetType: "User", targetId: s.editorB.id, permission: "View" },
        { targetType: "User", targetId: s.viewer.id, permission: "View" },
      ],
    });
    // new set: editorB Edit (changed), manager View (added). viewer is removed.
    const final = await replaceDocumentShares(prisma, s.editor.id, s.orgId, doc.id, {
      shares: [
        { targetType: "User", targetId: s.editorB.id, permission: "Edit" },
        { targetType: "User", targetId: s.manager.id, permission: "View" },
      ],
    });
    const byTarget = new Map(final.map((r) => [r.targetId, r.permission] as const));
    expect(byTarget.get(s.editorB.id)).toBe("Edit");
    expect(byTarget.get(s.manager.id)).toBe("View");
    expect(byTarget.has(s.viewer.id)).toBe(false);
    expect(final).toHaveLength(2);
  });

  it("PUT with empty shares clears all rows", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "x",
      documentType: "general",
    });
    await replaceDocumentShares(prisma, s.editor.id, s.orgId, doc.id, {
      shares: [{ targetType: "User", targetId: s.editorB.id, permission: "View" }],
    });
    const final = await replaceDocumentShares(prisma, s.editor.id, s.orgId, doc.id, {
      shares: [],
    });
    expect(final).toEqual([]);
  });

  it("audit: replace writes a DOCUMENT_SHARES_UPDATED row with added/updated/removed counts", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "audit",
      documentType: "general",
    });
    await replaceDocumentShares(prisma, s.editor.id, s.orgId, doc.id, {
      shares: [
        { targetType: "User", targetId: s.editorB.id, permission: "View" },
        { targetType: "User", targetId: s.viewer.id, permission: "View" },
      ],
    });
    await replaceDocumentShares(prisma, s.editor.id, s.orgId, doc.id, {
      shares: [
        { targetType: "User", targetId: s.editorB.id, permission: "Edit" },
        { targetType: "User", targetId: s.manager.id, permission: "View" },
      ],
    });
    // Most-recent log row for this document should reflect the diff:
    // editorB updated (View -> Edit), manager added, viewer removed.
    const log = await prisma.activityLog.findFirst({
      where: { action: "document.shares_updated", targetId: doc.id },
      orderBy: { createdAt: "desc" },
    });
    expect(log).not.toBeNull();
    const meta = log!.metadata as {
      added: number;
      updated: number;
      removed: number;
      total: number;
    } | null;
    expect(meta).toMatchObject({ added: 1, updated: 1, removed: 1, total: 2 });
    expect(log!.targetType).toBe("document");
    expect(log!.actorUserId).toBe(s.editor.id);
  });
});
