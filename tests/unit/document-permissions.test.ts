// Phase C step 2 — document permission unit tests.
//
// Pins the rules that Phase C / F services rely on:
//   - cross-org access is NOT_FOUND (no existence leak)
//   - Private + no share = NOT_FOUND, even for Admin
//   - Team visibility uses the actor's single primary team
//   - SpecificUsers requires an explicit share row
//   - Manage > Edit > View; multiple grants take the max
//   - Viewer role caps at View even on documents they own
//   - status=Deleted (or deletedAt set) = NOT_FOUND
//   - has-View-but-not-Edit -> FORBIDDEN(document_edit_not_allowed)

import { describe, expect, it } from "vitest";

import {
  ApiError,
  type DocumentActor,
  type DocumentContext,
  type DocumentShareGrant,
  evaluateDocumentPermission,
  permissionAtLeast,
  requireDocumentEdit,
  requireDocumentManage,
  requireDocumentView,
} from "@notive/permissions";

// ---------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------

const ORG = "org-1";
const ORG_OTHER = "org-2";
const TEAM_A = "team-a";
const TEAM_B = "team-b";
const USER_OWNER = "user-owner";
const USER_VIEWER = "user-viewer";
const USER_EDITOR = "user-editor";
const USER_ADMIN = "user-admin";
const USER_MANAGER = "user-manager";
const USER_AUTHOR = "user-author";
const USER_OUTSIDER = "user-outsider";

function actor(over: Partial<DocumentActor> = {}): DocumentActor {
  return {
    userId: USER_EDITOR,
    organizationId: ORG,
    role: "Editor",
    teamId: TEAM_A,
    ...over,
  };
}

function doc(over: Partial<DocumentContext> = {}): DocumentContext {
  return {
    id: "doc-1",
    organizationId: ORG,
    status: "Active",
    authorUserId: USER_OWNER,
    ownerUserId: USER_OWNER,
    ownerTeamId: TEAM_A,
    visibility: "Private",
    deletedAt: null,
    ...over,
  };
}

// ---------------------------------------------------------------------
// permissionAtLeast
// ---------------------------------------------------------------------

describe("permissionAtLeast", () => {
  it("Manage covers Edit and View", () => {
    expect(permissionAtLeast("Manage", "Manage")).toBe(true);
    expect(permissionAtLeast("Manage", "Edit")).toBe(true);
    expect(permissionAtLeast("Manage", "View")).toBe(true);
  });

  it("Edit covers View but not Manage", () => {
    expect(permissionAtLeast("Edit", "Edit")).toBe(true);
    expect(permissionAtLeast("Edit", "View")).toBe(true);
    expect(permissionAtLeast("Edit", "Manage")).toBe(false);
  });

  it("View covers only View", () => {
    expect(permissionAtLeast("View", "View")).toBe(true);
    expect(permissionAtLeast("View", "Edit")).toBe(false);
    expect(permissionAtLeast("View", "Manage")).toBe(false);
  });
});

// ---------------------------------------------------------------------
// Cross-organization: NOT_FOUND, no leak
// ---------------------------------------------------------------------

describe("cross-organization access", () => {
  it("returns null when actor.organizationId differs from document.organizationId", () => {
    const result = evaluateDocumentPermission(
      actor({ organizationId: ORG_OTHER }),
      doc({ visibility: "Organization" }),
      [],
    );
    expect(result).toBeNull();
  });

  it("requireDocumentView throws NOT_FOUND on cross-org access (no reason_code)", () => {
    try {
      requireDocumentView(
        actor({ organizationId: ORG_OTHER }),
        doc({ visibility: "Organization" }),
        [],
      );
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("NOT_FOUND");
      expect((err as ApiError).reason).toBeNull();
    }
  });

  it("ignores share rows that match by id when the document is in another org", () => {
    // An attacker guesses a doc id from another org. Even if they happen
    // to be the target of a share row in their own org with the same id,
    // the cross-org gate fires first.
    const share: DocumentShareGrant = {
      targetType: "User",
      targetId: USER_EDITOR,
      permission: "Manage",
    };
    const result = evaluateDocumentPermission(
      actor({ organizationId: ORG_OTHER }),
      doc({ visibility: "SpecificUsers" }),
      [share],
    );
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------
// Private documents
// ---------------------------------------------------------------------

describe("Private visibility", () => {
  it("non-owner without a share -> NOT_FOUND, even for Admin", () => {
    const result = evaluateDocumentPermission(
      actor({ userId: USER_ADMIN, role: "Admin" }),
      doc({ visibility: "Private", ownerUserId: USER_OWNER, ownerTeamId: TEAM_A }),
      [],
    );
    expect(result).toBeNull();
  });

  it("owner sees Manage", () => {
    const result = evaluateDocumentPermission(
      actor({ userId: USER_OWNER, role: "Editor" }),
      doc({ visibility: "Private", ownerUserId: USER_OWNER }),
      [],
    );
    expect(result).toBe("Manage");
  });

  it("non-owner with explicit View share -> View", () => {
    const share: DocumentShareGrant = {
      targetType: "User",
      targetId: USER_VIEWER,
      permission: "View",
    };
    const result = evaluateDocumentPermission(
      actor({ userId: USER_VIEWER, role: "Editor" }),
      doc({ visibility: "Private", ownerUserId: USER_OWNER }),
      [share],
    );
    expect(result).toBe("View");
  });
});

// ---------------------------------------------------------------------
// Team visibility — single primary team rule
// ---------------------------------------------------------------------

describe("Team visibility", () => {
  it("same team -> View", () => {
    const result = evaluateDocumentPermission(
      actor({ userId: USER_VIEWER, role: "Editor", teamId: TEAM_A }),
      doc({ visibility: "Team", ownerTeamId: TEAM_A }),
      [],
    );
    expect(result).toBe("View");
  });

  it("different team -> NOT_FOUND", () => {
    const result = evaluateDocumentPermission(
      actor({ userId: USER_VIEWER, role: "Editor", teamId: TEAM_B }),
      doc({ visibility: "Team", ownerTeamId: TEAM_A }),
      [],
    );
    expect(result).toBeNull();
  });

  it("actor without a primary team -> NOT_FOUND", () => {
    const result = evaluateDocumentPermission(
      actor({ userId: USER_VIEWER, role: "Editor", teamId: null }),
      doc({ visibility: "Team", ownerTeamId: TEAM_A }),
      [],
    );
    expect(result).toBeNull();
  });

  it("document without owner_team_id -> NOT_FOUND on Team visibility", () => {
    const result = evaluateDocumentPermission(
      actor({ userId: USER_VIEWER, role: "Editor", teamId: TEAM_A }),
      doc({ visibility: "Team", ownerTeamId: null }),
      [],
    );
    expect(result).toBeNull();
  });

  it("Team-target share bumps the permission above View", () => {
    const share: DocumentShareGrant = {
      targetType: "Team",
      targetId: TEAM_A,
      permission: "Edit",
    };
    const result = evaluateDocumentPermission(
      actor({ userId: USER_EDITOR, role: "Editor", teamId: TEAM_A }),
      doc({ visibility: "Team", ownerTeamId: TEAM_A }),
      [share],
    );
    expect(result).toBe("Edit");
  });
});

// ---------------------------------------------------------------------
// Organization visibility — and Admin's lack of implicit body access
// ---------------------------------------------------------------------

describe("Organization visibility", () => {
  it("any active member of the same org sees View", () => {
    const result = evaluateDocumentPermission(
      actor({ userId: USER_VIEWER, role: "Editor", teamId: TEAM_B }),
      doc({ visibility: "Organization", ownerTeamId: TEAM_A }),
      [],
    );
    expect(result).toBe("View");
  });

  it("Admin gets View on Org-public documents — same path as anyone else, no implicit bump", () => {
    const result = evaluateDocumentPermission(
      actor({ userId: USER_ADMIN, role: "Admin", teamId: TEAM_B }),
      doc({ visibility: "Organization", ownerUserId: USER_OWNER, ownerTeamId: TEAM_A }),
      [],
    );
    expect(result).toBe("View");
  });

  it("Admin does NOT get implicit View on Private documents — body access requires Org-public or explicit share (Phase A §15)", () => {
    const result = evaluateDocumentPermission(
      actor({ userId: USER_ADMIN, role: "Admin", teamId: TEAM_B }),
      doc({ visibility: "Private", ownerUserId: USER_OWNER, ownerTeamId: TEAM_A }),
      [],
    );
    expect(result).toBeNull();
  });

  it("Admin does NOT get implicit View on SpecificUsers documents either", () => {
    const result = evaluateDocumentPermission(
      actor({ userId: USER_ADMIN, role: "Admin", teamId: TEAM_B }),
      doc({ visibility: "SpecificUsers", ownerUserId: USER_OWNER, ownerTeamId: TEAM_A }),
      [],
    );
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------
// SpecificUsers — share rows are the only access path
// ---------------------------------------------------------------------

describe("SpecificUsers visibility", () => {
  it("non-target without a matching share -> NOT_FOUND", () => {
    const share: DocumentShareGrant = {
      targetType: "User",
      targetId: USER_VIEWER,
      permission: "Edit",
    };
    const result = evaluateDocumentPermission(
      actor({ userId: USER_OUTSIDER, role: "Editor" }),
      doc({ visibility: "SpecificUsers" }),
      [share],
    );
    expect(result).toBeNull();
  });

  it("target with View share -> View", () => {
    const share: DocumentShareGrant = {
      targetType: "User",
      targetId: USER_VIEWER,
      permission: "View",
    };
    const result = evaluateDocumentPermission(
      actor({ userId: USER_VIEWER, role: "Editor" }),
      doc({ visibility: "SpecificUsers" }),
      [share],
    );
    expect(result).toBe("View");
  });

  it("target with Edit share -> Edit", () => {
    const share: DocumentShareGrant = {
      targetType: "User",
      targetId: USER_VIEWER,
      permission: "Edit",
    };
    const result = evaluateDocumentPermission(
      actor({ userId: USER_VIEWER, role: "Editor" }),
      doc({ visibility: "SpecificUsers" }),
      [share],
    );
    expect(result).toBe("Edit");
  });

  it("target with Manage share -> Manage", () => {
    const share: DocumentShareGrant = {
      targetType: "User",
      targetId: USER_VIEWER,
      permission: "Manage",
    };
    const result = evaluateDocumentPermission(
      actor({ userId: USER_VIEWER, role: "Editor" }),
      doc({ visibility: "SpecificUsers" }),
      [share],
    );
    expect(result).toBe("Manage");
  });

  it("multiple share rows -> max permission wins (Manage > Edit > View)", () => {
    const shares: DocumentShareGrant[] = [
      { targetType: "User", targetId: USER_EDITOR, permission: "View" },
      { targetType: "Team", targetId: TEAM_A, permission: "Manage" },
      { targetType: "Organization", targetId: ORG, permission: "Edit" },
    ];
    const result = evaluateDocumentPermission(
      actor({ userId: USER_EDITOR, role: "Editor", teamId: TEAM_A }),
      doc({ visibility: "SpecificUsers" }),
      shares,
    );
    expect(result).toBe("Manage");
  });

  it("Organization-target share grants to all org members", () => {
    const share: DocumentShareGrant = {
      targetType: "Organization",
      targetId: ORG,
      permission: "Edit",
    };
    const result = evaluateDocumentPermission(
      actor({ userId: USER_OUTSIDER, role: "Editor", teamId: TEAM_B }),
      doc({ visibility: "SpecificUsers" }),
      [share],
    );
    expect(result).toBe("Edit");
  });
});

// ---------------------------------------------------------------------
// Soft-delete / Deleted state
// ---------------------------------------------------------------------

describe("soft-delete and Deleted state", () => {
  it("status=Deleted -> NOT_FOUND even for the owner", () => {
    const result = evaluateDocumentPermission(
      actor({ userId: USER_OWNER }),
      doc({ status: "Deleted", visibility: "Organization" }),
      [],
    );
    expect(result).toBeNull();
  });

  it("deletedAt set -> NOT_FOUND even when status is still Active in the row", () => {
    const result = evaluateDocumentPermission(
      actor({ userId: USER_OWNER }),
      doc({ deletedAt: new Date(), visibility: "Organization" }),
      [],
    );
    expect(result).toBeNull();
  });

  it("Archived documents are still accessible via the standard rules", () => {
    const result = evaluateDocumentPermission(
      actor({ userId: USER_VIEWER, role: "Editor" }),
      doc({ status: "Archived", visibility: "Organization" }),
      [],
    );
    expect(result).toBe("View");
  });
});

// ---------------------------------------------------------------------
// Role cap — Viewer
// ---------------------------------------------------------------------

describe("role cap: Viewer", () => {
  it("Viewer who owns the document is still capped at View (Phase C plan §8.2)", () => {
    const result = evaluateDocumentPermission(
      actor({ userId: USER_OWNER, role: "Viewer" }),
      doc({ visibility: "Private", ownerUserId: USER_OWNER }),
      [],
    );
    expect(result).toBe("View");
  });

  it("Viewer with Manage share is capped at View", () => {
    const share: DocumentShareGrant = {
      targetType: "User",
      targetId: USER_VIEWER,
      permission: "Manage",
    };
    const result = evaluateDocumentPermission(
      actor({ userId: USER_VIEWER, role: "Viewer" }),
      doc({ visibility: "SpecificUsers" }),
      [share],
    );
    expect(result).toBe("View");
  });

  it("Viewer with no grant -> still NOT_FOUND, role cap does not invent access", () => {
    const result = evaluateDocumentPermission(
      actor({ userId: USER_OUTSIDER, role: "Viewer" }),
      doc({ visibility: "Private", ownerUserId: USER_OWNER }),
      [],
    );
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------
// Throwing helpers — error policy
// ---------------------------------------------------------------------

describe("requireDocumentView / Edit / Manage error policy", () => {
  const sharesView: DocumentShareGrant[] = [
    { targetType: "User", targetId: USER_VIEWER, permission: "View" },
  ];
  const sharesEdit: DocumentShareGrant[] = [
    { targetType: "User", targetId: USER_EDITOR, permission: "Edit" },
  ];
  const target = doc({ visibility: "SpecificUsers" });

  it("View-only actor: requireDocumentView passes, returns 'View'", () => {
    const p = requireDocumentView(actor({ userId: USER_VIEWER }), target, sharesView);
    expect(p).toBe("View");
  });

  it("View-only actor: requireDocumentEdit throws FORBIDDEN(document_edit_not_allowed)", () => {
    try {
      requireDocumentEdit(actor({ userId: USER_VIEWER }), target, sharesView);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ApiError).code).toBe("FORBIDDEN");
      expect((err as ApiError).reason).toBe("document_edit_not_allowed");
    }
  });

  it("Edit actor: requireDocumentEdit passes, returns 'Edit'", () => {
    const p = requireDocumentEdit(actor({ userId: USER_EDITOR }), target, sharesEdit);
    expect(p).toBe("Edit");
  });

  it("Edit actor: requireDocumentManage throws FORBIDDEN(document_manage_not_allowed)", () => {
    try {
      requireDocumentManage(actor({ userId: USER_EDITOR }), target, sharesEdit);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ApiError).code).toBe("FORBIDDEN");
      expect((err as ApiError).reason).toBe("document_manage_not_allowed");
    }
  });

  it("No grant: requireDocumentView throws NOT_FOUND, no reason_code (no existence leak)", () => {
    try {
      requireDocumentView(actor({ userId: USER_OUTSIDER }), target, sharesView);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ApiError).code).toBe("NOT_FOUND");
      expect((err as ApiError).reason).toBeNull();
    }
  });

  it("No grant: requireDocumentEdit also throws NOT_FOUND (not FORBIDDEN) — Phase A §15", () => {
    try {
      requireDocumentEdit(actor({ userId: USER_OUTSIDER }), target, sharesView);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ApiError).code).toBe("NOT_FOUND");
      expect((err as ApiError).reason).toBeNull();
    }
  });

  it("No grant: requireDocumentManage also throws NOT_FOUND", () => {
    try {
      requireDocumentManage(actor({ userId: USER_OUTSIDER }), target, sharesView);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ApiError).code).toBe("NOT_FOUND");
      expect((err as ApiError).reason).toBeNull();
    }
  });

  it("Owner: requireDocumentManage passes", () => {
    const p = requireDocumentManage(
      actor({ userId: USER_OWNER, role: "Editor" }),
      doc({ visibility: "Private", ownerUserId: USER_OWNER }),
      [],
    );
    expect(p).toBe("Manage");
  });
});

// ---------------------------------------------------------------------
// Manager team-document moderation (Phase C plan §8.2 / §8.3 +
// permission policy §6.5–6.6 — bounded by visibility=Team).
// ---------------------------------------------------------------------

describe("Manager team-document moderation", () => {
  it("Manager grants Manage on Team-visible documents owned by their primary team", () => {
    const result = evaluateDocumentPermission(
      actor({ userId: USER_MANAGER, role: "Manager", teamId: TEAM_A }),
      doc({ visibility: "Team", ownerUserId: USER_OWNER, ownerTeamId: TEAM_A }),
      [],
    );
    expect(result).toBe("Manage");
  });

  it("Manager bump does NOT apply to Private documents — owner / author / share are still required", () => {
    const result = evaluateDocumentPermission(
      actor({ userId: USER_MANAGER, role: "Manager", teamId: TEAM_A }),
      doc({ visibility: "Private", ownerUserId: USER_OWNER, ownerTeamId: TEAM_A }),
      [],
    );
    expect(result).toBeNull();
  });

  it("Manager bump does NOT apply to SpecificUsers documents — explicit share is still required", () => {
    const result = evaluateDocumentPermission(
      actor({ userId: USER_MANAGER, role: "Manager", teamId: TEAM_A }),
      doc({ visibility: "SpecificUsers", ownerUserId: USER_OWNER, ownerTeamId: TEAM_A }),
      [],
    );
    expect(result).toBeNull();
  });

  it("Manager on Organization-public documents still uses the normal user path (View, not Manage)", () => {
    // visibility=Organization grants View to every org member,
    // including Managers. The Manager bump does not fire because
    // visibility !== Team, so the result is the View grant from the
    // visibility=Organization path — not Manage.
    const result = evaluateDocumentPermission(
      actor({ userId: USER_MANAGER, role: "Manager", teamId: TEAM_A }),
      doc({ visibility: "Organization", ownerUserId: USER_OWNER, ownerTeamId: TEAM_A }),
      [],
    );
    expect(result).toBe("View");
  });

  it("Manager on Team-visible documents owned by ANOTHER team -> NOT_FOUND", () => {
    const result = evaluateDocumentPermission(
      actor({ userId: USER_MANAGER, role: "Manager", teamId: TEAM_A }),
      doc({ visibility: "Team", ownerUserId: USER_OWNER, ownerTeamId: TEAM_B }),
      [],
    );
    expect(result).toBeNull();
  });

  it("Manager without a primary team gets no team-doc grant", () => {
    const result = evaluateDocumentPermission(
      actor({ userId: USER_MANAGER, role: "Manager", teamId: null }),
      doc({ visibility: "Team", ownerUserId: USER_OWNER, ownerTeamId: TEAM_A }),
      [],
    );
    expect(result).toBeNull();
  });

  it("Manager on Team-visible document with null owner_team_id gets no team-doc grant", () => {
    const result = evaluateDocumentPermission(
      actor({ userId: USER_MANAGER, role: "Manager", teamId: TEAM_A }),
      doc({ visibility: "Team", ownerUserId: USER_OWNER, ownerTeamId: null }),
      [],
    );
    expect(result).toBeNull();
  });

  it("Manager bump still respects Deleted state — Deleted Team document is NOT_FOUND", () => {
    const result = evaluateDocumentPermission(
      actor({ userId: USER_MANAGER, role: "Manager", teamId: TEAM_A }),
      doc({ status: "Deleted", visibility: "Team", ownerTeamId: TEAM_A }),
      [],
    );
    expect(result).toBeNull();
  });

  it("Manager bump still respects org boundary — same team_id literal in another org is NOT_FOUND", () => {
    // The doc lives in ORG with ownerTeamId=TEAM_A. The Manager actor
    // is in ORG_OTHER with the same team-id literal value. The DB
    // composite FK on (id, organization_id) would already prevent the
    // shared team-id, but the helper does not assume that — the
    // org-boundary gate must fire first regardless of team match.
    const result = evaluateDocumentPermission(
      actor({
        userId: USER_MANAGER,
        role: "Manager",
        teamId: TEAM_A,
        organizationId: ORG_OTHER,
      }),
      doc({ visibility: "Team", ownerTeamId: TEAM_A }),
      [],
    );
    expect(result).toBeNull();
  });

  it("requireDocumentManage passes for Manager of the owner team on a Team-visible document", () => {
    const p = requireDocumentManage(
      actor({ userId: USER_MANAGER, role: "Manager", teamId: TEAM_A }),
      doc({ visibility: "Team", ownerUserId: USER_OWNER, ownerTeamId: TEAM_A }),
      [],
    );
    expect(p).toBe("Manage");
  });

  it("Manager can still reach Private team docs via an explicit share — bump and share are independent paths", () => {
    const share: DocumentShareGrant = {
      targetType: "User",
      targetId: USER_MANAGER,
      permission: "Edit",
    };
    const result = evaluateDocumentPermission(
      actor({ userId: USER_MANAGER, role: "Manager", teamId: TEAM_A }),
      doc({ visibility: "Private", ownerUserId: USER_OWNER, ownerTeamId: TEAM_A }),
      [share],
    );
    // No Manager bump (visibility=Private), but the share grants Edit.
    expect(result).toBe("Edit");
  });
});

// ---------------------------------------------------------------------
// Author View grant (Phase C plan §8 / permission policy)
// ---------------------------------------------------------------------

describe("author View grant", () => {
  it("author who is not the owner gets at least View on Private documents", () => {
    const result = evaluateDocumentPermission(
      actor({ userId: USER_AUTHOR, role: "Editor", teamId: TEAM_B }),
      doc({
        visibility: "Private",
        authorUserId: USER_AUTHOR,
        ownerUserId: USER_OWNER,
        ownerTeamId: TEAM_A,
      }),
      [],
    );
    expect(result).toBe("View");
  });

  it("author with no Edit/Manage share: requireDocumentEdit throws FORBIDDEN(document_edit_not_allowed)", () => {
    try {
      requireDocumentEdit(
        actor({ userId: USER_AUTHOR, role: "Editor" }),
        doc({ visibility: "Private", authorUserId: USER_AUTHOR, ownerUserId: USER_OWNER }),
        [],
      );
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ApiError).code).toBe("FORBIDDEN");
      expect((err as ApiError).reason).toBe("document_edit_not_allowed");
    }
  });

  it("author with explicit Edit share gains Edit", () => {
    const share: DocumentShareGrant = {
      targetType: "User",
      targetId: USER_AUTHOR,
      permission: "Edit",
    };
    const result = evaluateDocumentPermission(
      actor({ userId: USER_AUTHOR, role: "Editor" }),
      doc({ visibility: "Private", authorUserId: USER_AUTHOR, ownerUserId: USER_OWNER }),
      [share],
    );
    expect(result).toBe("Edit");
  });

  it("Viewer who is the author is still capped at View even with a Manage share (role cap)", () => {
    const share: DocumentShareGrant = {
      targetType: "User",
      targetId: USER_AUTHOR,
      permission: "Manage",
    };
    const result = evaluateDocumentPermission(
      actor({ userId: USER_AUTHOR, role: "Viewer" }),
      doc({ visibility: "Private", authorUserId: USER_AUTHOR, ownerUserId: USER_OWNER }),
      [share],
    );
    expect(result).toBe("View");
  });

  it("author on a document whose author_user_id was hard-purged (null) gets nothing from the author path", () => {
    const result = evaluateDocumentPermission(
      actor({ userId: USER_AUTHOR, role: "Editor" }),
      doc({ visibility: "Private", authorUserId: null, ownerUserId: USER_OWNER }),
      [],
    );
    expect(result).toBeNull();
  });

  it("author on a Deleted document still gets NOT_FOUND", () => {
    const result = evaluateDocumentPermission(
      actor({ userId: USER_AUTHOR, role: "Editor" }),
      doc({
        status: "Deleted",
        visibility: "Private",
        authorUserId: USER_AUTHOR,
        ownerUserId: USER_OWNER,
      }),
      [],
    );
    expect(result).toBeNull();
  });

  it("cross-org author does not bypass the org boundary", () => {
    const result = evaluateDocumentPermission(
      actor({ userId: USER_AUTHOR, role: "Editor", organizationId: ORG_OTHER }),
      doc({ visibility: "Private", authorUserId: USER_AUTHOR, ownerUserId: USER_OWNER }),
      [],
    );
    expect(result).toBeNull();
  });
});
