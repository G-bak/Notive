// Common HTTP error response helpers.
//
// Maps `AuthError` (packages/auth) and `ApiError` (this app) to the
// status + reason_code envelope per Phase A §15. The envelope shape is:
//
//   { "error": <code>, "reason_code": <code-or-reason> }
//
// `error` carries the broad code (UNAUTHORIZED / NOT_FOUND / FORBIDDEN /
// CONFLICT / INVALID_INPUT). `reason_code` carries the specific reason
// (last_admin_protection, EMAIL_TAKEN, ...). For NOT_FOUND, reason_code
// is omitted by design — the client must not learn whether the resource
// was hidden vs absent.

import { AuthError } from "@notive/auth";
import { NextResponse } from "next/server";

import { ApiError } from "./api-error";

interface StatusReason {
  status: number;
  reason: string;
}

const AUTH_MAP: Record<string, StatusReason> = {
  INVALID_INPUT: { status: 400, reason: "INVALID_INPUT" },
  INVALID_CREDENTIALS: { status: 401, reason: "INVALID_CREDENTIALS" },
  UNAUTHORIZED: { status: 401, reason: "UNAUTHORIZED" },
  EMAIL_NOT_VERIFIED: { status: 403, reason: "EMAIL_NOT_VERIFIED" },
  ACCOUNT_DISABLED: { status: 403, reason: "ACCOUNT_DISABLED" },
  TOKEN_INVALID: { status: 400, reason: "TOKEN_INVALID" },
  TOKEN_EXPIRED: { status: 400, reason: "TOKEN_EXPIRED" },
  EMAIL_TAKEN: { status: 409, reason: "EMAIL_TAKEN" },
};

export function respondError(err: unknown): NextResponse {
  if (err instanceof AuthError) {
    const m = AUTH_MAP[err.code] ?? { status: 400, reason: err.code };
    return NextResponse.json({ error: m.reason, reason_code: m.reason }, { status: m.status });
  }
  if (err instanceof ApiError) {
    if (err.code === "NOT_FOUND") {
      // Phase A §15: NOT_FOUND must not leak any reason.
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json(
      { error: err.code, reason_code: err.reason ?? err.code },
      { status: err.status },
    );
  }
  // Unknown errors must not leak internal detail.
  // eslint-disable-next-line no-console
  console.error("[api] unexpected error", err);
  return NextResponse.json(
    { error: "INTERNAL_ERROR", reason_code: "INTERNAL_ERROR" },
    { status: 500 },
  );
}

/** Backwards-compatible alias used by Step 4 auth routes. */
export const respondAuthError = respondError;

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
