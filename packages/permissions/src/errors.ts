// Permission Module — error envelope.
//
// Phase A §15 / Phase B doc §13.5 lock: this package is the only place
// that constructs permission-denial errors. App route handlers map them
// to HTTP responses but never decide *what* to deny.
//
// Envelope shape (rendered by apps/web/lib/http.ts):
//
//   { "error": <code>, "reason_code"?: <reason> }
//
// - NOT_FOUND      -> 404, NO reason_code (Phase A §15: must not leak
//                     whether a resource was hidden vs absent).
// - FORBIDDEN      -> 403, reason_code is REQUIRED.
// - CONFLICT       -> 409, reason_code is REQUIRED.
// - INVALID_INPUT  -> 400, reason_code optional (the message field
//                     carries the validation detail when needed).
//
// `reason_code` values are an open-ended string but the well-known
// values used across Step 4 / Step 5 are listed in `KnownReasonCode`
// for documentation and for the unit tests that pin them.

export type ApiErrorCode = "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "INVALID_INPUT";

/**
 * Reason codes that the Permission Module emits today. Adding a new
 * value here is a contract change — bump the relevant doc(s).
 */
export type KnownReasonCode =
  // FORBIDDEN
  | "admin_only"
  | "manager_cannot_invite"
  | "last_admin_protection"
  | "account_not_active"
  // FORBIDDEN — Phase C document feature checks. Used when the actor
  // already has at least View on the document but the requested action
  // requires a higher permission. Pure absence of view stays NOT_FOUND
  // (Phase A §15 — no resource-existence leak).
  | "document_edit_not_allowed"
  | "document_manage_not_allowed"
  // FORBIDDEN — Phase C document create. Used when the actor's role is
  // Viewer (Phase C plan §8.2: Viewer cannot create documents).
  | "document_create_not_allowed"
  // FORBIDDEN — Phase C step 7 tag vocabulary. createTag rejects
  // Viewer; deleteTag rejects Editor (Manager+ only).
  | "tag_create_not_allowed"
  | "tag_delete_not_allowed"
  // CONFLICT
  | "already_in_organization"
  | "slug_taken"
  | "invitation_pending"
  | "invitation_not_pending"
  | "invitation_expired"
  // CONFLICT — Phase C step 5. Concurrent writers raced on
  // (document_id, version_number); the unique index aborted the
  // losing transaction and the helper translates P2002 to this
  // reason code so the route returns a clean 409. Phase C does not
  // retry inside the same transaction (Postgres marks aborted
  // transactions unusable); see apps/web/lib/services/document-
  // version.ts for the escalation path if this fires too often.
  | "version_conflict";

const STATUS_FOR: Record<ApiErrorCode, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  CONFLICT: 409,
  INVALID_INPUT: 400,
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly reason: string | null;
  readonly status: number;

  constructor(code: ApiErrorCode, opts: { reason?: string; message?: string } = {}) {
    super(opts.message ?? code);
    this.name = "ApiError";
    this.code = code;
    this.reason = opts.reason ?? null;
    this.status = STATUS_FOR[code];
  }
}

/**
 * Convenience constructors. Service code should use these instead of
 * `new ApiError(...)` so the call sites read like policy assertions.
 */
export const Errors = {
  /** Cross-org / hidden / id-guess. Carries no reason_code. */
  notFound(): ApiError {
    return new ApiError("NOT_FOUND");
  },
  /**
   * Authenticated but feature-not-permitted. reason_code required.
   * Accepts an open string so future routes can introduce reason codes
   * without first amending `KnownReasonCode`; the existing values in
   * that union document the well-known set.
   */
  forbidden(reason: string): ApiError {
    return new ApiError("FORBIDDEN", { reason });
  },
  /** Resource collision. reason_code required. */
  conflict(reason: string): ApiError {
    return new ApiError("CONFLICT", { reason });
  },
  /** Validation failure. reason_code optional. */
  invalid(message?: string): ApiError {
    return new ApiError("INVALID_INPUT", { message });
  },
};
