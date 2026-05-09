// Common HTTP error response helpers.
//
// Maps `AuthError` to status + reason_code per Phase A §15:
//   - INVALID_INPUT       -> 400
//   - INVALID_CREDENTIALS -> 401
//   - UNAUTHORIZED        -> 401
//   - EMAIL_NOT_VERIFIED  -> 403 FORBIDDEN(EMAIL_NOT_VERIFIED)
//   - ACCOUNT_DISABLED    -> 403 FORBIDDEN(ACCOUNT_DISABLED)
//   - TOKEN_INVALID       -> 400
//   - TOKEN_EXPIRED       -> 400
//   - EMAIL_TAKEN         -> 409 CONFLICT(EMAIL_TAKEN)
//
// Bodies are intentionally short. We return a stable reason_code but do
// not echo any token, password, or full email back to the client.

import { AuthError } from "@notive/auth";
import { NextResponse } from "next/server";

interface StatusReason {
  status: number;
  reason: string;
}

const MAP: Record<string, StatusReason> = {
  INVALID_INPUT: { status: 400, reason: "INVALID_INPUT" },
  INVALID_CREDENTIALS: { status: 401, reason: "INVALID_CREDENTIALS" },
  UNAUTHORIZED: { status: 401, reason: "UNAUTHORIZED" },
  EMAIL_NOT_VERIFIED: { status: 403, reason: "EMAIL_NOT_VERIFIED" },
  ACCOUNT_DISABLED: { status: 403, reason: "ACCOUNT_DISABLED" },
  TOKEN_INVALID: { status: 400, reason: "TOKEN_INVALID" },
  TOKEN_EXPIRED: { status: 400, reason: "TOKEN_EXPIRED" },
  EMAIL_TAKEN: { status: 409, reason: "EMAIL_TAKEN" },
};

export function respondAuthError(err: unknown): NextResponse {
  if (err instanceof AuthError) {
    const m = MAP[err.code] ?? { status: 400, reason: err.code };
    return NextResponse.json({ error: m.reason, reason_code: m.reason }, { status: m.status });
  }
  // Unknown errors must not leak internal detail.
  // eslint-disable-next-line no-console
  console.error("[auth] unexpected error", err);
  return NextResponse.json(
    { error: "INTERNAL_ERROR", reason_code: "INTERNAL_ERROR" },
    { status: 500 },
  );
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
