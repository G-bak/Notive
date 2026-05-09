// Application-level error envelope for Phase B step 5+.
//
// Phase A §15 error policy:
//   - Cross-org / hidden / direct-id-guess access  -> NOT_FOUND
//   - Authenticated but feature-not-permitted      -> FORBIDDEN + reason_code
//   - Last-Admin protection                        -> FORBIDDEN(last_admin_protection)
//   - Validation failure                           -> INVALID_INPUT
//   - Resource conflict (dup name/slug, etc.)      -> CONFLICT + reason_code
//
// `reason_code` is mandatory on FORBIDDEN/CONFLICT so the client can
// branch on a stable identifier without parsing prose. NOT_FOUND
// deliberately has no reason_code — it must be indistinguishable from
// "the resource simply does not exist."

export type ApiErrorCode = "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "INVALID_INPUT";

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

export const Errors = {
  notFound(): ApiError {
    return new ApiError("NOT_FOUND");
  },
  forbidden(reason: string): ApiError {
    return new ApiError("FORBIDDEN", { reason });
  },
  conflict(reason: string): ApiError {
    return new ApiError("CONFLICT", { reason });
  },
  invalid(message?: string): ApiError {
    return new ApiError("INVALID_INPUT", { message });
  },
};
