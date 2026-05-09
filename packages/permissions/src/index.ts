// Permission Module type stubs only.
//
// Per Phase B doc section 13.5: this package is the only place that emits
// permission-denial responses. App route handlers must call into it.
//
// Phase B step 6 (section 13.6) replaces these stubs with real logic.
// Until then this module exposes types and the public surface so that
// other packages can compile against the contract.

import type { ApiError, ErrorCode, ForbiddenReason, Role } from "@notive/shared";

/**
 * The actor whose access is being decided. Always derived server-side
 * from the session and active membership; never trusted from a request body.
 */
export interface PermissionContext {
  userId: string;
  organizationId: string;
  teamId: string | null;
  role: Role;
}

/**
 * Result of a permission decision.
 *
 * - `allow`: caller may proceed.
 * - `deny`: caller must not proceed; the route handler returns the carried
 *   `error`. Phase A section 15 / Codex: NOT_FOUND is the default; FORBIDDEN is
 *   reserved for the authenticated-but-feature-not-allowed case.
 */
export type PermissionDecision = { allow: true } | { allow: false; error: ApiError };

export type PermissionCheck<TInput = void> = (
  ctx: PermissionContext,
  input: TInput,
) => PermissionDecision | Promise<PermissionDecision>;

/**
 * Convenience constructors for the two denial shapes. The Permission
 * Module is the only place that should construct these. That is the
 * "centralize denial" rule from Phase B doc section 13.5.
 */
export function denyNotFound(message = "Not found"): PermissionDecision {
  const error: ApiError = {
    code: "NOT_FOUND" satisfies ErrorCode,
    message,
  };
  return { allow: false, error };
}

export function denyForbidden(reason: ForbiddenReason, message = "Forbidden"): PermissionDecision {
  const error: ApiError = {
    code: "FORBIDDEN" satisfies ErrorCode,
    message,
    reasonCode: reason,
  };
  return { allow: false, error };
}

export const allow: PermissionDecision = { allow: true };

export const PERMISSIONS_PACKAGE_PLACEHOLDER = true as const;
