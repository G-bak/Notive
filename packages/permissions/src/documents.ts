// Permission Module — document permission helpers (Phase C step 2).
//
// Single source of truth for "can this user View / Edit / Manage this
// document?". Phase C API routes, services, and Phase F search must
// route every document permission decision through these helpers
// rather than rebuilding the rule inline.
//
// Phase A §15 / Phase C plan §8 locks reflected here:
//
//   - 1 user = 1 active organization. Cross-org access is invisible
//     (NOT_FOUND, no reason_code).
//   - 1 user = 1 primary team via memberships.team_id. Team
//     visibility / team-target shares match against this single team
//     id.
//   - Department is consolidated into Team. The DocumentVisibility
//     enum has no Department member (DB schema enforces this).
//   - Admin has NO implicit document-body access. Admin's role does
//     not bump per-document grants. Body access for an Admin still
//     comes from ownership / Organization-public visibility / explicit
//     share — same path as any other user.
//   - Manager moderates Team-visible documents owned by their primary
//     team. Phase C plan §8.2 / §8.3 + permission policy §6.5–6.6:
//     Manager's moderation scope is "team-permitted documents", which
//     in this codebase means visibility=Team owned by the actor's
//     team. Private and SpecificUsers documents owned by the same
//     team still require owner / author / explicit share — Manager's
//     role does NOT bypass the deliberate narrowing of those
//     visibilities.
//   - Author of a document retains at least View even when they are
//     not the owner — e.g. an AI-draft flow may set author=actor and
//     owner=team_lead. Phase C does NOT bump author past View; an
//     explicit share is required for Edit/Manage.
//   - Viewer is capped at View regardless of grants, including on
//     documents they own. Phase C plan §8.2 forbids Viewer from
//     editing any document.
//   - Permission rank: Manage > Edit > View. Helpers return the
//     highest grant the actor has (or null = no access).
//
// Error policy (Phase B step 6 §15 / Phase C plan §15.2):
//
//   - Cross-org / soft-deleted / no grant   -> NOT_FOUND
//   - Has View but action wants Edit/Manage -> FORBIDDEN(reason)
//
// The view-vs-feature split prevents existence leaks: a stranger
// poking document UUIDs cannot tell apart "document does not exist"
// from "document exists but you cannot see it".

import type {
  DocumentSharePermission,
  DocumentShareTargetType,
  DocumentStatus,
  DocumentVisibility,
  RoleCode,
} from "@notive/db";

import { Errors } from "./errors.js";

/**
 * Permission rank, ascending. The numeric value is internal — callers
 * should treat the strings as an enum and use {@link permissionAtLeast}
 * to compare.
 */
const PERMISSION_RANK: Record<DocumentSharePermission, number> = {
  View: 0,
  Edit: 1,
  Manage: 2,
};

/** True when `actual` covers everything `minimum` does. View ≤ Edit ≤ Manage. */
export function permissionAtLeast(
  actual: DocumentSharePermission,
  minimum: DocumentSharePermission,
): boolean {
  return PERMISSION_RANK[actual] >= PERMISSION_RANK[minimum];
}

/**
 * The actor making the request. `teamId` is the actor's single primary
 * team for this organization (Phase A §15). `null` means the actor is
 * not assigned to any team yet — Team visibility / team-target shares
 * never grant access in that case.
 */
export interface DocumentActor {
  userId: string;
  organizationId: string;
  role: RoleCode;
  teamId: string | null;
}

/**
 * The document under consideration. Field set is the minimum needed to
 * make a permission decision; service code passes a projection of the
 * `documents` row.
 */
export interface DocumentContext {
  id: string;
  organizationId: string;
  status: DocumentStatus;
  /** Author of the original document. Currently does not grant any
   * permission on its own (only ownership does); kept on the context
   * for future audit / display use. */
  authorUserId: string | null;
  ownerUserId: string | null;
  ownerTeamId: string | null;
  visibility: DocumentVisibility;
  deletedAt: Date | null;
}

/** A row from `document_shares`, projected to the fields the helper reads. */
export interface DocumentShareGrant {
  targetType: DocumentShareTargetType;
  targetId: string;
  permission: DocumentSharePermission;
}

/**
 * Compute the highest permission `actor` has on `document`, or `null`
 * if the actor has no access at all. Pure function — does not throw.
 *
 * Called by the `requireDocument*` helpers and also reused by Phase F
 * search to filter out documents the actor cannot see (returning
 * `null` documents from search rows).
 *
 * Algorithm:
 *   1. Cross-org or soft-deleted document       -> null
 *   2. Build the set of grants:
 *        owner                                       -> Manage
 *        author                                      -> View
 *        Manager + visibility=Team & in owner team   -> Manage
 *        visibility=Organization                     -> View (org members)
 *        visibility=Team & actor in owner team       -> View
 *        each matching share row                     -> share.permission
 *   3. If no grants                              -> null
 *   4. Take the rank-max grant
 *   5. Cap at View when actor.role === "Viewer"
 *      (Phase C plan §8.2: Viewer cannot edit any document — even
 *       owned ones — by role definition)
 */
export function evaluateDocumentPermission(
  actor: DocumentActor,
  document: DocumentContext,
  shares: readonly DocumentShareGrant[],
): DocumentSharePermission | null {
  // 1. Organization boundary. Phase A §15: cross-org access is
  //    indistinguishable from "does not exist".
  if (document.organizationId !== actor.organizationId) return null;

  // 2. A Deleted document is hidden from everyone. Archived documents
  //    are still permission-checked normally — they appear in the
  //    archived filter for users who already had access.
  if (document.status === "Deleted" || document.deletedAt !== null) return null;

  const grants: DocumentSharePermission[] = [];

  // Owner gets Manage. ownerUserId may be null when the original owner
  // was hard-purged (FK SetNull); in that case ownership grants nothing.
  if (document.ownerUserId !== null && document.ownerUserId === actor.userId) {
    grants.push("Manage");
  }

  // Author gets View even when they are not the owner. Phase C plan §8
  // / permission policy — an author should not lose visibility on
  // documents they wrote when ownership is moved (e.g. AI-draft flows
  // that set owner = team lead). Author is intentionally NOT bumped to
  // Edit/Manage; an explicit share is required for higher access.
  // authorUserId may be null when the original author was hard-purged
  // (FK SetNull); in that case the author path grants nothing.
  if (document.authorUserId !== null && document.authorUserId === actor.userId) {
    grants.push("View");
  }

  // Manager moderation on Team-visible documents owned by their
  // primary team. Phase C plan §8.2 / §8.3 + permission policy §6.5–
  // 6.6: Manager's "team-permitted documents" scope is bounded by
  // visibility=Team. Private and SpecificUsers documents owned by
  // the same team still require owner / author / explicit share —
  // Manager does NOT bypass the deliberate narrowing of those
  // visibilities.
  if (
    actor.role === "Manager" &&
    document.visibility === "Team" &&
    actor.teamId !== null &&
    document.ownerTeamId !== null &&
    actor.teamId === document.ownerTeamId
  ) {
    grants.push("Manage");
  }

  // Visibility-derived view grants.
  if (document.visibility === "Organization") {
    grants.push("View");
  } else if (
    document.visibility === "Team" &&
    actor.teamId !== null &&
    document.ownerTeamId !== null &&
    actor.teamId === document.ownerTeamId
  ) {
    grants.push("View");
  }
  // Private / SpecificUsers: visibility alone grants nothing; access
  // comes from ownership or explicit shares only.

  // Share rows. A share applies if its target matches the actor.
  // Multiple shares are allowed; each contributes its own grant and
  // we take the rank-max in step 4.
  for (const share of shares) {
    if (share.targetType === "User" && share.targetId === actor.userId) {
      grants.push(share.permission);
    } else if (
      share.targetType === "Team" &&
      actor.teamId !== null &&
      share.targetId === actor.teamId
    ) {
      grants.push(share.permission);
    } else if (share.targetType === "Organization" && share.targetId === actor.organizationId) {
      grants.push(share.permission);
    }
  }

  let max: DocumentSharePermission | null = null;
  for (const g of grants) {
    if (max === null || PERMISSION_RANK[g] > PERMISSION_RANK[max]) max = g;
  }
  if (max === null) return null;

  // Role cap. Viewer is the only role that limits the maximum
  // attainable permission across all paths — even on documents they
  // own or authored. Editor and Admin do not implicitly bump grants
  // (Phase A §15: Admin has no implicit body-access pass). Manager's
  // implicit bump is encoded above as a per-document grant tied to
  // the owner team, not as a role-wide cap.
  if (actor.role === "Viewer") return "View";

  return max;
}

/**
 * Throw NOT_FOUND when the actor cannot view the document. Returns
 * the actor's permission level on success so the caller can branch on
 * View vs Edit vs Manage without a second evaluation.
 */
export function requireDocumentView(
  actor: DocumentActor,
  document: DocumentContext,
  shares: readonly DocumentShareGrant[],
): DocumentSharePermission {
  const p = evaluateDocumentPermission(actor, document, shares);
  if (p === null) throw Errors.notFound();
  return p;
}

/**
 * Throw NOT_FOUND when the actor cannot view the document. Throw
 * FORBIDDEN(document_edit_not_allowed) when the actor has only View.
 * Returns "Edit" or "Manage" on success.
 */
export function requireDocumentEdit(
  actor: DocumentActor,
  document: DocumentContext,
  shares: readonly DocumentShareGrant[],
): "Edit" | "Manage" {
  const p = evaluateDocumentPermission(actor, document, shares);
  if (p === null) throw Errors.notFound();
  if (p === "View") throw Errors.forbidden("document_edit_not_allowed");
  return p;
}

/**
 * Throw NOT_FOUND when the actor cannot view the document. Throw
 * FORBIDDEN(document_manage_not_allowed) when the actor has only
 * View or Edit. Returns "Manage" on success.
 */
export function requireDocumentManage(
  actor: DocumentActor,
  document: DocumentContext,
  shares: readonly DocumentShareGrant[],
): "Manage" {
  const p = evaluateDocumentPermission(actor, document, shares);
  if (p === null) throw Errors.notFound();
  if (p !== "Manage") throw Errors.forbidden("document_manage_not_allowed");
  return p;
}
