// Login + logout.
//
// Login returns the raw session token on success. The caller (the API
// route) is responsible for setting it as an HttpOnly cookie. Failure
// modes are deliberately collapsed:
//   - unknown email          -> INVALID_CREDENTIALS
//   - wrong password         -> INVALID_CREDENTIALS
//   - account Pending        -> EMAIL_NOT_VERIFIED   (after pw match, see below)
//   - account Disabled/Del.  -> ACCOUNT_DISABLED      (after pw match)
//
// We perform the password verification BEFORE returning EMAIL_NOT_VERIFIED
// or ACCOUNT_DISABLED so callers cannot distinguish "this email is
// registered" from "this email is not registered" by checking only
// status. (i.e. wrong-password on a Disabled account still returns
// INVALID_CREDENTIALS, not ACCOUNT_DISABLED.)

import type { PrismaClient } from "@notive/db";
import { z } from "zod";

import { AuthError } from "./errors.js";
import { verifyPassword } from "./password.js";
import {
  type CreateSessionResult,
  type SessionTtl,
  createSession,
  revokeSessionByToken,
} from "./session.js";

export const loginInputSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export interface LoginOptions {
  ttl: SessionTtl;
}

export async function login(
  prisma: PrismaClient,
  rawInput: unknown,
  opts: LoginOptions,
): Promise<CreateSessionResult> {
  const parsed = loginInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new AuthError("INVALID_INPUT", "invalid input");
  }
  const email = parsed.data.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    // Run a dummy verify so timing is similar to the "user exists" path.
    await verifyPassword(parsed.data.password, DUMMY_HASH);
    throw new AuthError("INVALID_CREDENTIALS", "invalid email or password");
  }
  const ok = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!ok) {
    throw new AuthError("INVALID_CREDENTIALS", "invalid email or password");
  }
  if (user.status === "Pending") {
    throw new AuthError("EMAIL_NOT_VERIFIED", "email not verified");
  }
  if (user.status === "Disabled" || user.status === "Deleted") {
    throw new AuthError("ACCOUNT_DISABLED", "account is not active");
  }

  const result = await createSession(prisma, user.id, opts.ttl);
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });
  return result;
}

export async function logout(prisma: PrismaClient, token: string | undefined): Promise<void> {
  if (!token) {
    return;
  }
  await revokeSessionByToken(prisma, token);
}

// scrypt$N$r$p$<random16>$<random64> for "neverMatchesAnything01".
// Hard-coded so the dummy verify costs the same as a real verify.
const DUMMY_HASH =
  "scrypt$16384$8$1$" +
  "AAAAAAAAAAAAAAAAAAAAAA==$" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";
