// Auth error codes.
//
// API routes translate these into HTTP status + reason_code per Phase A
// §15 conventions:
//   - UNAUTHORIZED  -> 401 (no session / invalid session)
//   - FORBIDDEN     -> 403 (account disabled, email not verified, etc.)
//   - NOT_FOUND     -> 404 (resource hidden by permission)
//   - INVALID_INPUT -> 400 (zod parse failure, weak password, etc.)
//   - CONFLICT      -> 409 (duplicate email at signup)
//
// Login uses INVALID_CREDENTIALS so the same response is returned for
// "no such user" and "wrong password" (no user enumeration).

export type AuthErrorCode =
  | "INVALID_INPUT"
  | "INVALID_CREDENTIALS"
  | "EMAIL_TAKEN"
  | "EMAIL_NOT_VERIFIED"
  | "ACCOUNT_DISABLED"
  | "TOKEN_INVALID"
  | "TOKEN_EXPIRED"
  | "UNAUTHORIZED";

export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}
