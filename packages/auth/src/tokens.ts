// Opaque token generation and hashing.
//
// Used for: session tokens (carried in cookie), email verification tokens,
// password reset tokens.
//
// Format: 32 random bytes encoded base64url (43 ASCII chars). Hash:
// sha256 hex digest. The plain token is delivered to the user (cookie
// or email) once; only the hash lands in the database.

import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
