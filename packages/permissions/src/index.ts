// @notive/permissions — single source for permission decisions.
//
// Step 6 replaced the old type-stub surface (denyForbidden / denyNotFound /
// PermissionDecision) with concrete `ApiError`-based checks. The previous
// helpers were never wired into the routes; the new surface is what
// services in apps/web/lib/services/* depend on.

export { ApiError, Errors } from "./errors.js";
export type { ApiErrorCode, KnownReasonCode } from "./errors.js";

export {
  assertNotLastAdmin,
  requireActiveUser,
  requireAdmin,
  requireMembership,
  roleAtLeast,
} from "./checks.js";
