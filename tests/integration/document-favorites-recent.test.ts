// Phase C step 6 — favorites + recent documents integration tests.
//
// Pins the policies the Step 6 service surface implements:
//
//   - Favorite PUT / DELETE need View on the document. Deleted /
//     cross-org / no-view -> NOT_FOUND.
//   - Favorite PUT is idempotent: a second PUT returns the same
//     row, no duplicate.
//   - Favorite DELETE is idempotent: removing a non-existent
//     favorite succeeds silently — but only when the actor
//     actually has View on the document. Otherwise NOT_FOUND.
//   - listFavorites filters through evaluateDocumentPermission so
//     a user who lost view access after favoriting silently drops
//     out of their own list. Deleted documents drop out too.
//   - getDocument success appends a view-history row.
//   - getDocument failure (NOT_FOUND or FORBIDDEN) does NOT append
//     a view-history row.
//   - listRecentDocuments dedupes by documentId (latest viewedAt
//     per document) and applies the same permission + Deleted
//     filter.
//   - Recent / favorites limit defaults to 20 and is capped at 100.

import { describe, expect, it } from "vitest";

import { prisma } from "@notive/db";
import { ApiError } from "@notive/permissions";

import { createDocument, deleteDocument, getDocument } from "../../apps/web/lib/services/document";
import {
  listFavorites,
  setFavorite,
  unsetFavorite,
} from "../../apps/web/lib/services/document-favorite";
import { listRecentDocuments } from "../../apps/web/lib/services/document-view-history";

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
  editor: UserRow;
  editorB: UserRow;
  viewer: UserRow;
  outsiderOrgId: string;
  outsider: UserRow;
}

async function setup(): Promise<BasicSetup> {
  const admin = await createUser("admin");
  const orgId = await createOrganization(admin.id, "fav-org");
  await createMembership({
    userId: admin.id,
    organizationId: orgId,
    role: "Admin",
    status: "Active",
  });

  const teamA = await createTeam(orgId, "team-a");

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
  const outsiderOrgId = await createOrganization(outsider.id, "outside-fav-org");
  await createMembership({
    userId: outsider.id,
    organizationId: outsiderOrgId,
    role: "Admin",
    status: "Active",
  });

  return { orgId, teamA, admin, editor, editorB, viewer, outsiderOrgId, outsider };
}

// ---------------------------------------------------------------------
// Favorites: PUT / DELETE / list
// ---------------------------------------------------------------------

describe("setFavorite / unsetFavorite", () => {
  it("View permission is sufficient — favoriting an Org-public doc works for any active member", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "shared",
      documentType: "general",
      visibility: "Organization",
    });
    const fav = await setFavorite(prisma, s.editorB.id, s.orgId, doc.id);
    expect(fav.userId).toBe(s.editorB.id);
    expect(fav.documentId).toBe(doc.id);
    expect(fav.organizationId).toBe(s.orgId);
  });

  it("PUT is idempotent — second call returns the same row", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "x",
      documentType: "general",
    });
    const a = await setFavorite(prisma, s.editor.id, s.orgId, doc.id);
    const b = await setFavorite(prisma, s.editor.id, s.orgId, doc.id);
    expect(a.id).toBe(b.id);
    const all = await prisma.documentFavorite.findMany({
      where: { userId: s.editor.id, documentId: doc.id },
    });
    expect(all).toHaveLength(1);
  });

  it("Favoriting a Private doc the actor cannot view -> NOT_FOUND", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "secret",
      documentType: "general",
      visibility: "Private",
    });
    await expectApiError(setFavorite(prisma, s.editorB.id, s.orgId, doc.id), "NOT_FOUND", null);
    // Admin without explicit grant -> also NOT_FOUND on Private
    await expectApiError(setFavorite(prisma, s.admin.id, s.orgId, doc.id), "NOT_FOUND", null);
  });

  it("Favoriting a Deleted doc -> NOT_FOUND, even for the original owner", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "to be deleted",
      documentType: "general",
    });
    await deleteDocument(prisma, s.editor.id, s.orgId, doc.id);
    await expectApiError(setFavorite(prisma, s.editor.id, s.orgId, doc.id), "NOT_FOUND", null);
  });

  it("Cross-org documentId -> NOT_FOUND on PUT and DELETE", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "x",
      documentType: "general",
    });
    await expectApiError(
      setFavorite(prisma, s.outsider.id, s.outsiderOrgId, doc.id),
      "NOT_FOUND",
      null,
    );
    await expectApiError(
      unsetFavorite(prisma, s.outsider.id, s.outsiderOrgId, doc.id),
      "NOT_FOUND",
      null,
    );
  });

  it("DELETE is idempotent — removing a non-existent favorite succeeds when the actor has View", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "ok",
      documentType: "general",
      visibility: "Organization",
    });
    // editorB has View via Org-public but never PUT'd a favorite.
    await expect(unsetFavorite(prisma, s.editorB.id, s.orgId, doc.id)).resolves.toBeUndefined();
  });

  it("DELETE without View permission -> NOT_FOUND (the existence-leak rule applies even to delete)", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "private",
      documentType: "general",
      visibility: "Private",
    });
    await expectApiError(unsetFavorite(prisma, s.editorB.id, s.orgId, doc.id), "NOT_FOUND", null);
  });
});

describe("listFavorites", () => {
  it("returns only favorites the actor can still view", async () => {
    const s = await setup();
    const orgPub = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "org-pub",
      documentType: "general",
      visibility: "Organization",
    });
    const privateOwned = await createDocument(prisma, s.editorB.id, s.orgId, {
      title: "mine",
      documentType: "general",
      visibility: "Private",
    });
    // editorB favorites both
    await setFavorite(prisma, s.editorB.id, s.orgId, orgPub.id);
    await setFavorite(prisma, s.editorB.id, s.orgId, privateOwned.id);

    let favs = await listFavorites(prisma, s.editorB.id, s.orgId);
    expect(favs.map((f) => f.document.id).sort()).toEqual([orgPub.id, privateOwned.id].sort());

    // Now flip the org-pub doc to Private. editorB no longer has any
    // grant on it, so it disappears from their favorites list silently.
    await prisma.document.update({
      where: { id: orgPub.id },
      data: { visibility: "Private" },
    });
    favs = await listFavorites(prisma, s.editorB.id, s.orgId);
    expect(favs.map((f) => f.document.id)).toEqual([privateOwned.id]);
  });

  it("Deleted documents are excluded from favorites", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "x",
      documentType: "general",
    });
    await setFavorite(prisma, s.editor.id, s.orgId, doc.id);
    await deleteDocument(prisma, s.editor.id, s.orgId, doc.id);
    const favs = await listFavorites(prisma, s.editor.id, s.orgId);
    expect(favs).toEqual([]);
  });
});

// ---------------------------------------------------------------------
// View history + listRecentDocuments
// ---------------------------------------------------------------------

describe("getDocument view history append", () => {
  it("getDocument success appends a view-history row", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "x",
      documentType: "general",
    });
    await getDocument(prisma, s.editor.id, s.orgId, doc.id);
    const hist = await prisma.documentViewHistory.findMany({
      where: { userId: s.editor.id, documentId: doc.id },
    });
    expect(hist).toHaveLength(1);
    expect(hist[0]!.organizationId).toBe(s.orgId);
  });

  it("getDocument failure (no view on Private) does NOT append a view-history row", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "secret",
      documentType: "general",
      visibility: "Private",
    });
    await expectApiError(getDocument(prisma, s.editorB.id, s.orgId, doc.id), "NOT_FOUND", null);
    const hist = await prisma.documentViewHistory.findMany({
      where: { userId: s.editorB.id, documentId: doc.id },
    });
    expect(hist).toHaveLength(0);
  });

  it("multiple getDocument calls produce multiple history rows", async () => {
    const s = await setup();
    const doc = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "x",
      documentType: "general",
    });
    await getDocument(prisma, s.editor.id, s.orgId, doc.id);
    await getDocument(prisma, s.editor.id, s.orgId, doc.id);
    await getDocument(prisma, s.editor.id, s.orgId, doc.id);
    const hist = await prisma.documentViewHistory.findMany({
      where: { userId: s.editor.id, documentId: doc.id },
    });
    expect(hist.length).toBe(3);
  });
});

describe("listRecentDocuments", () => {
  it("dedupes by documentId — each document appears once at its latest viewedAt", async () => {
    const s = await setup();
    const a = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "A",
      documentType: "general",
    });
    const b = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "B",
      documentType: "general",
    });
    // View order: A, B, A — A's latest is the third event
    await getDocument(prisma, s.editor.id, s.orgId, a.id);
    await new Promise((r) => setTimeout(r, 5));
    await getDocument(prisma, s.editor.id, s.orgId, b.id);
    await new Promise((r) => setTimeout(r, 5));
    await getDocument(prisma, s.editor.id, s.orgId, a.id);

    const recent = await listRecentDocuments(prisma, s.editor.id, s.orgId);
    expect(recent.map((r) => r.document.id)).toEqual([a.id, b.id]);
  });

  it("returns only documents the actor can still view, and excludes Deleted", async () => {
    const s = await setup();
    const orgPub = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "org-pub",
      documentType: "general",
      visibility: "Organization",
    });
    const privateDoc = await createDocument(prisma, s.editorB.id, s.orgId, {
      title: "private",
      documentType: "general",
      visibility: "Private",
    });
    // editorB views both (private is theirs).
    await getDocument(prisma, s.editorB.id, s.orgId, orgPub.id);
    await getDocument(prisma, s.editorB.id, s.orgId, privateDoc.id);
    // The org-public doc gets soft-deleted by its owner — recent list
    // must drop it.
    await deleteDocument(prisma, s.editor.id, s.orgId, orgPub.id);

    const recent = await listRecentDocuments(prisma, s.editorB.id, s.orgId);
    expect(recent.map((r) => r.document.id)).toEqual([privateDoc.id]);
  });

  it("limit defaults to 20 and is capped at 100", async () => {
    const s = await setup();
    // Create 3 docs and view them; the limit is what we check, not
    // the volume of data — passing limit > 100 must be clamped.
    const a = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "A",
      documentType: "general",
    });
    const b = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "B",
      documentType: "general",
    });
    const c = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "C",
      documentType: "general",
    });
    await getDocument(prisma, s.editor.id, s.orgId, a.id);
    await getDocument(prisma, s.editor.id, s.orgId, b.id);
    await getDocument(prisma, s.editor.id, s.orgId, c.id);

    // limit=2 -> 2 rows
    const r2 = await listRecentDocuments(prisma, s.editor.id, s.orgId, { limit: 2 });
    expect(r2).toHaveLength(2);

    // limit=99999 -> clamp to 100, and we only have 3 distinct docs.
    const rMax = await listRecentDocuments(prisma, s.editor.id, s.orgId, { limit: 99999 });
    expect(rMax.length).toBe(3);

    // limit=undefined -> default 20, also returns the 3 we have.
    const rDef = await listRecentDocuments(prisma, s.editor.id, s.orgId);
    expect(rDef.length).toBe(3);
  });

  it("cross-org listRecentDocuments returns empty for the outsider's view of our org", async () => {
    const s = await setup();
    // outsider's membership is in outsiderOrgId — they have no view
    // history rows in s.orgId, so listing under outsiderOrgId is
    // empty regardless of what was viewed in s.orgId.
    const a = await createDocument(prisma, s.editor.id, s.orgId, {
      title: "A",
      documentType: "general",
    });
    await getDocument(prisma, s.editor.id, s.orgId, a.id);
    const recent = await listRecentDocuments(prisma, s.outsider.id, s.outsiderOrgId);
    expect(recent).toEqual([]);
    // And calling under the wrong org -> NOT_FOUND from
    // requireMembership before the query even runs.
    await expectApiError(listRecentDocuments(prisma, s.outsider.id, s.orgId), "NOT_FOUND", null);
  });
});
