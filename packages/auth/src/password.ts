// Password hashing and policy.
//
// We use Node's built-in scrypt (no external dep). The on-disk format is
// "scrypt$N$r$p$salt_b64$hash_b64" so future parameter changes can be
// detected and migrated without re-hashing every record.
//
// Password policy (Phase A security guideline §3.2):
//   - min 10 characters
//   - must include at least one letter and one digit
//   - max 256 characters (defense against pathological inputs)
//
// `verifyPassword` uses `timingSafeEqual` to avoid timing leaks.

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import { AuthError } from "./errors.js";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const SCHEME = "scrypt";
const N = 1 << 14; // 16384
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 256;

export function validatePasswordPolicy(password: string): void {
  if (typeof password !== "string") {
    throw new AuthError("INVALID_INPUT", "password must be a string");
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new AuthError(
      "INVALID_INPUT",
      `password must be at least ${PASSWORD_MIN_LENGTH} characters`,
    );
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new AuthError(
      "INVALID_INPUT",
      `password must be at most ${PASSWORD_MAX_LENGTH} characters`,
    );
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new AuthError("INVALID_INPUT", "password must contain at least one letter and one digit");
  }
}

export async function hashPassword(password: string): Promise<string> {
  validatePasswordPolicy(password);
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(password, salt, KEYLEN);
  return [
    SCHEME,
    String(N),
    String(R),
    String(P),
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (typeof password !== "string" || typeof stored !== "string") {
    return false;
  }
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== SCHEME) {
    return false;
  }
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const n = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) {
    return false;
  }
  // Reject parameters that differ from current — for MVP we never
  // re-parameterize. If a future change lowers cost we'd reject here
  // and force a re-hash on next login.
  if (n !== N || r !== R || p !== P) {
    return false;
  }
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  const derived = await scrypt(password, salt, expected.length);
  if (derived.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(derived, expected);
}
