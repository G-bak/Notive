// Phase C step 7 — tags + document list filters integration tests.
//
// Pins the policies the Step 7 service surface implements:
//
//   - Tag CRUD role gates: any member can list, Editor+ can create
//     (idempotent on duplicate name), Manager+ can delete (Editor /
//     Viewer rejected with reason codes).
//   - Per-document tag set is replace-all and requires Edit on the
//     document. View-only -> FORBIDDEN(document_edit_not_allowed),
//     no-view -> NOT_FOUND. Cross-org tagId in the payload -> NOT_FOUND.
//     Duplicate tag id in the payload -> INVALID_INPUT.
//   - Tag delete cascades to document_tag_links via the DB FK.
//   - listDocuments filters layer cleanly on top of permission filter:
//     status / visibility / documentType / ownerTeamId / authorUserId /
//     favorite=true / tagId / q. Permission filter still runs after
//     SQL filter, so a forged tagId from another org cannot leak
//     anything.
//   - listDocuments default limit 20, capped at 100.
//   - DOCUMENT_TAGS_UPDATED audit row carries { added, removed, total }.
//   - Tag create / delete are NOT recorded in audit (Phase C scope).

import { describe, expect, it } from "vitest";

import { prisma } from "@notive/db";
import { ApiError } from "@notive/permissions";

import {
  createDocument,
  deleteDocument,
  listDocuments,
} from "../../apps/web/lib/services/document";
import { setFavorite } from "../../apps/web/lib/services/document-favorite";
import {
  createTag,
  deleteTag,
  listTags,
  setDocumentTags,
} from "../../apps/web/lib/services/document-tag";

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
  const orgId = await createOrganization(admin.id, "tag-org");
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
  const outsiderOrgId = await createOrganization(outsider.id, "outside-tag-org");
  await createMembership({
    userId: outsider.id,
    organizationId: outsiderOrgId,
    role: "Admin",
    status: "Active",
  });

  return { orgId, teamA, teamB, admin, manager, editor, editorB, viewer, outsiderOrgId, outsider };
}

// ---------------------------------------------------------------------
// Tag CRUD
// ---------------------------------------------------------------------

describe("tag CRUD", () => {
  it("Editor can create a tag; tags list returns it", async () => {
    const s = await setup();
    const t = await createTag(prisma, s.editor.id, s.orgId, { name: "  ops  " });
    expect(t.name).toBe("ops"); // trimmed
    const all = await listTags(prisma, s.editorB.id, s.orgId);
    expect(all.map((x) => x.id)).toContain(t.id);
  });

  it("Viewer cannot create a tag — FORBIDDEN(tag_create_not_allowed)", async () => {
    const s = await setup();
    await expectApiError(
      createTag(prisma, s.viewer.id, s.orgId, { name: "x" }),
      "FORBIDDEN",
      "tag_create_not_allowed",
    );
  });

  it("create with empty name -> INVALID_INPUT", async () => {
    const s = await setup();
    await expectApiError(createTag(prisma, s.editor.id, s.orgId, { name: "   " }), "INVALID_INPUT");
  });

  it("create with duplicate name in same org -> idempotent (returns existing)", async () => {
    const s = await setup();
    const a = await createTag(prisma, s.editor.id, s.orgId, { name: "dup" });
    const b = await createTag(prisma, s.manager.id, s.orgId, { name: "dup" });
    expect(a.id).toBe(b.id);
    const count = await prisma.documentTag.count({
      where: { organizationId: s.orgId, name: "dup" },
    });
    expect(count).toBe(1);
  });

  it("listTags is org-scoped — outsider sees only their own org's tags", async () => {
    const s = await setup();
    await createTag(prisma, s.editor.id, s.orgId, { name: "alpha" });
    const outsiderTags = await listTags(prisma, s.outsider.id, s.outsiderOrgId);
    expect(outsiderTags.find((t) => t.name === "alpha")).toBeUndefined();
  });

  it("Editor cannot delete a tag — FORBIDDEN(tag_delete_not_allowed)", async () => {
    const s = await setup();
    const t = await createTag(prisma, s.editor.id, s.orgId, { name: "del-me" });
    await expectApiError(
      deleteTag(prisma, s.editor.id, s.orgId, t.id),
      "FORBIDDEN",
      "tag_delete_not_allowed",
    );
  });

  it("Manager can delete a tag; existing tag links cascade away", async () => {
    const s = await setup();
    const t = await createTag(prisma, s.editor.id, s.orgId, { name: "cleanup" });
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "x",
      documentType: "general",
    });
    await setDocumentTags(prisma, s.editor.id, s.orgId, doc.id, { tagIds: [t.id] });
    expect(await prisma.documentTagLink.count({ where: { documentId: doc.id, tagId: t.id } })).toBe(
      1,
    );

    await deleteTag(prisma, s.manager.id, s.orgId, t.id);
    expect(await prisma.documentTag.count({ where: { id: t.id } })).toBe(0);
    // FK CASCADE removed the link automatically.
    expect(await prisma.documentTagLink.count({ where: { tagId: t.id } })).toBe(0);
  });

  it("cross-org tag delete -> NOT_FOUND", async () => {
    const s = await setup();
    const t = await createTag(prisma, s.editor.id, s.orgId, { name: "x" });
    await expectApiError(
      deleteTag(prisma, s.outsider.id, s.outsiderOrgId, t.id),
      "NOT_FOUND",
      null,
    );
  });
});

// ---------------------------------------------------------------------
// setDocumentTags
// ---------------------------------------------------------------------

describe("setDocumentTags (replace-all)", () => {
  it("Owner (Edit) can set tags; subsequent PUT replaces the set", async () => {
    const s = await setup();
    const tag1 = await createTag(prisma, s.editor.id, s.orgId, { name: "a" });
    const tag2 = await createTag(prisma, s.editor.id, s.orgId, { name: "b" });
    const tag3 = await createTag(prisma, s.editor.id, s.orgId, { name: "c" });
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "x",
      documentType: "general",
    });
    let r = await setDocumentTags(prisma, s.editor.id, s.orgId, doc.id, {
      tagIds: [tag1.id, tag2.id],
    });
    expect(r.tags.map((t) => t.id).sort()).toEqual([tag1.id, tag2.id].sort());
    expect(r.added).toBe(2);
    expect(r.removed).toBe(0);

    r = await setDocumentTags(prisma, s.editor.id, s.orgId, doc.id, {
      tagIds: [tag2.id, tag3.id],
    });
    expect(r.tags.map((t) => t.id).sort()).toEqual([tag2.id, tag3.id].sort());
    expect(r.added).toBe(1); // tag3 added
    expect(r.removed).toBe(1); // tag1 removed
    expect(r.total).toBe(2);
  });

  it("View-only viewer cannot set tags — FORBIDDEN(document_edit_not_allowed)", async () => {
    const s = await setup();
    const tag = await createTag(prisma, s.editor.id, s.orgId, { name: "x" });
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "org",
      documentType: "general",
      visibility: "Organization",
    });
    await expectApiError(
      setDocumentTags(prisma, s.editorB.id, s.orgId, doc.id, { tagIds: [tag.id] }),
      "FORBIDDEN",
      "document_edit_not_allowed",
    );
  });

  it("no-view actor -> NOT_FOUND", async () => {
    const s = await setup();
    const tag = await createTag(prisma, s.editor.id, s.orgId, { name: "x" });
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "private",
      documentType: "general",
      visibility: "Private",
    });
    await expectApiError(
      setDocumentTags(prisma, s.editorB.id, s.orgId, doc.id, { tagIds: [tag.id] }),
      "NOT_FOUND",
      null,
    );
  });

  it("Deleted document -> NOT_FOUND", async () => {
    const s = await setup();
    const tag = await createTag(prisma, s.editor.id, s.orgId, { name: "x" });
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "x",
      documentType: "general",
    });
    await deleteDocument(prisma, s.editor.id, s.orgId, doc.id);
    await expectApiError(
      setDocumentTags(prisma, s.editor.id, s.orgId, doc.id, { tagIds: [tag.id] }),
      "NOT_FOUND",
      null,
    );
  });

  it("cross-org tagId in payload -> NOT_FOUND", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "x",
      documentType: "general",
    });
    // Make a tag in the outsider org
    const outsiderTag = await prisma.documentTag.create({
      data: { organizationId: s.outsiderOrgId, name: "outside" },
    });
    await expectApiError(
      setDocumentTags(prisma, s.editor.id, s.orgId, doc.id, { tagIds: [outsiderTag.id] }),
      "NOT_FOUND",
      null,
    );
  });

  it("duplicate tagId in payload -> INVALID_INPUT", async () => {
    const s = await setup();
    const tag = await createTag(prisma, s.editor.id, s.orgId, { name: "x" });
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "x",
      documentType: "general",
    });
    await expectApiError(
      setDocumentTags(prisma, s.editor.id, s.orgId, doc.id, {
        tagIds: [tag.id, tag.id],
      }),
      "INVALID_INPUT",
    );
  });

  it("audit: setDocumentTags writes DOCUMENT_TAGS_UPDATED with diff metadata", async () => {
    const s = await setup();
    const a = await createTag(prisma, s.editor.id, s.orgId, { name: "a" });
    const b = await createTag(prisma, s.editor.id, s.orgId, { name: "b" });
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "x",
      documentType: "general",
    });
    await setDocumentTags(prisma, s.editor.id, s.orgId, doc.id, { tagIds: [a.id] });
    await setDocumentTags(prisma, s.editor.id, s.orgId, doc.id, { tagIds: [b.id] });

    const log = await prisma.activityLog.findFirst({
      where: { action: "document.tags_updated", targetId: doc.id },
      orderBy: { createdAt: "desc" },
    });
    expect(log).not.toBeNull();
    const meta = log!.metadata as { added: number; removed: number; total: number } | null;
    expect(meta).toEqual({ added: 1, removed: 1, total: 1 });
  });
});

// ---------------------------------------------------------------------
// listDocuments filters
// ---------------------------------------------------------------------

describe("listDocuments filters", () => {
  it("filter by status / visibility / documentType / ownerTeamId / authorUserId", async () => {
    const s = await setup();
    const reportTeamA = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "report-a",
      documentType: "report",
      visibility: "Organization",
    });
    const reportTeamB = await createDocument(prisma, s.editorB.id, s.orgId, {
      title: "report-b",
      documentType: "report",
      visibility: "Organization",
    });
    const memoTeamA = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "memo",
      documentType: "memo",
      visibility: "Organization",
    });

    // documentType=report -> 2 results
    let r = await listDocuments(prisma, s.editor.id, s.orgId, { documentType: "report" });
    expect(r.map((d) => d.id).sort()).toEqual([reportTeamA.id, reportTeamB.id].sort());

    // ownerTeamId=teamA -> reportTeamA + memoTeamA
    r = await listDocuments(prisma, s.editor.id, s.orgId, { ownerTeamId: s.teamA });
    expect(r.map((d) => d.id).sort()).toEqual([reportTeamA.id, memoTeamA.id].sort());

    // authorUserId=editorB -> reportTeamB only
    r = await listDocuments(prisma, s.editor.id, s.orgId, { authorUserId: s.editorB.id });
    expect(r.map((d) => d.id)).toEqual([reportTeamB.id]);

    // visibility=Organization -> all three
    r = await listDocuments(prisma, s.editor.id, s.orgId, { visibility: "Organization" });
    expect(r).toHaveLength(3);
  });

  it("filter favorite=true returns only the actor's favorited documents", async () => {
    const s = await setup();
    const a = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "a",
      documentType: "general",
      visibility: "Organization",
    });
    const b = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "b",
      documentType: "general",
      visibility: "Organization",
    });
    await setFavorite(prisma, s.editor.id, s.orgId, a.id);
    // editorB does not favorite anything
    let r = await listDocuments(prisma, s.editor.id, s.orgId, { favorite: true });
    expect(r.map((d) => d.id)).toEqual([a.id]);
    r = await listDocuments(prisma, s.editorB.id, s.orgId, { favorite: true });
    expect(r).toEqual([]);
    void b;
  });

  it("filter by tagId returns only documents with that tag", async () => {
    const s = await setup();
    const tag = await createTag(prisma, s.editor.id, s.orgId, { name: "k" });
    const a = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "a",
      documentType: "general",
      visibility: "Organization",
    });
    const b = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "b",
      documentType: "general",
      visibility: "Organization",
    });
    await setDocumentTags(prisma, s.editor.id, s.orgId, a.id, { tagIds: [tag.id] });
    const r = await listDocuments(prisma, s.editor.id, s.orgId, { tagId: tag.id });
    expect(r.map((d) => d.id)).toEqual([a.id]);
    void b;
  });

  it("q filter matches title or content (case-insensitive)", async () => {
    const s = await setup();
    const a = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "Project Apollo plan",
      content: "boring body",
      documentType: "general",
      visibility: "Organization",
    });
    const b = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "Other doc",
      content: "mentions APOLLO inside",
      documentType: "general",
      visibility: "Organization",
    });
    const r = await listDocuments(prisma, s.editor.id, s.orgId, { q: "apollo" });
    expect(r.map((d) => d.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("filter result is permission-filtered — forged tagId from another org returns nothing", async () => {
    const s = await setup();
    const outsiderTag = await prisma.documentTag.create({
      data: { organizationId: s.outsiderOrgId, name: "out" },
    });
    const r = await listDocuments(prisma, s.editor.id, s.orgId, { tagId: outsiderTag.id });
    expect(r).toEqual([]);
  });

  it("limit defaults to 20 and is capped at 100", async () => {
    const s = await setup();
    // Create 25 org-public docs
    for (let i = 0; i < 25; i++) {
      await createDocument(prisma, s.editor.id, s.orgId, {
        title: `d-${i}`,
        documentType: "general",
        visibility: "Organization",
      });
    }
    // No filter, default limit=20 -> 20 results
    const def = await listDocuments(prisma, s.editor.id, s.orgId);
    expect(def).toHaveLength(20);
    // Explicit limit > MAX clamps to 100 (but we only have 25)
    const big = await listDocuments(prisma, s.editor.id, s.orgId, { limit: 99999 });
    expect(big).toHaveLength(25);
    // Explicit limit < 1 falls back to default
    const bad = await listDocuments(prisma, s.editor.id, s.orgId, { limit: 0 });
    expect(bad).toHaveLength(20);
  });
});
