// Signup + email verification + resend.
//
// Signup creates a Pending user, generates a verification token, hashes
// it into `email_verification_token_hash`, and dispatches a verification
// email containing the raw token. The user becomes Active only after
// the verify-email endpoint consumes the token successfully.
//
// Email match is case-insensitive on storage: we normalize to lowercase
// before lookup and persistence.

import type { PrismaClient } from "@notive/db";
import { type MailAdapter, buildVerifyEmailMessage } from "@notive/mail";
import { z } from "zod";

import { AuthError } from "./errors.js";
import { hashPassword } from "./password.js";
import { generateToken, hashToken } from "./tokens.js";

export const signupInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  password: z.string(),
});

export type SignupInput = z.infer<typeof signupInputSchema>;

export interface SignupOptions {
  appBaseUrl: string;
  verifyTtlHours: number;
}

export interface SignupResult {
  userId: string;
  // Tests need the raw token. Production wiring never exposes this; the
  // token leaves the process only via the mail body.
  emailVerificationToken: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function signup(
  prisma: PrismaClient,
  mail: MailAdapter,
  rawInput: unknown,
  opts: SignupOptions,
): Promise<SignupResult> {
  const parsed = signupInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new AuthError("INVALID_INPUT", parsed.error.issues[0]?.message ?? "invalid input");
  }
  const email = normalizeEmail(parsed.data.email);
  const passwordHash = await hashPassword(parsed.data.password);

  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + opts.verifyTtlHours * 60 * 60 * 1000);

  let userId: string;
  try {
    const created = await prisma.user.create({
      data: {
        name: parsed.data.name,
        email,
        passwordHash,
        status: "Pending",
        emailVerificationTokenHash: tokenHash,
        emailVerificationExpiresAt: expiresAt,
      },
    });
    userId = created.id;
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new AuthError("EMAIL_TAKEN", "email already registered");
    }
    throw err;
  }

  await mail.send(
    buildVerifyEmailMessage({
      appBaseUrl: opts.appBaseUrl,
      email,
      token,
      ttlHours: opts.verifyTtlHours,
    }),
  );

  return { userId, emailVerificationToken: token };
}

export const verifyEmailInputSchema = z.object({
  token: z.string().min(1),
});
export type VerifyEmailInput = z.infer<typeof verifyEmailInputSchema>;

export async function verifyEmail(
  prisma: PrismaClient,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<{ userId: string }> {
  const parsed = verifyEmailInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new AuthError("INVALID_INPUT", "invalid token");
  }
  const tokenHash = hashToken(parsed.data.token);
  const user = await prisma.user.findUnique({
    where: { emailVerificationTokenHash: tokenHash },
  });
  if (!user) {
    throw new AuthError("TOKEN_INVALID", "verification token not recognized");
  }
  if (
    !user.emailVerificationExpiresAt ||
    user.emailVerificationExpiresAt.getTime() <= now.getTime()
  ) {
    throw new AuthError("TOKEN_EXPIRED", "verification token expired");
  }
  if (user.status === "Disabled" || user.status === "Deleted") {
    throw new AuthError("ACCOUNT_DISABLED", "account is not eligible for verification");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      status: "Active",
      emailVerifiedAt: now,
      emailVerificationTokenHash: null,
      emailVerificationExpiresAt: null,
    },
  });
  return { userId: user.id };
}

export const resendVerificationInputSchema = z.object({
  email: z.string().trim().email().max(254),
});
export type ResendVerificationInput = z.infer<typeof resendVerificationInputSchema>;

export interface ResendOutcome {
  /** When the lookup succeeds and a new token was issued, the raw token. */
  emailVerificationToken: string | null;
}

export async function resendVerification(
  prisma: PrismaClient,
  mail: MailAdapter,
  rawInput: unknown,
  opts: SignupOptions,
): Promise<ResendOutcome> {
  const parsed = resendVerificationInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new AuthError("INVALID_INPUT", "invalid email");
  }
  const email = normalizeEmail(parsed.data.email);
  const user = await prisma.user.findUnique({ where: { email } });
  // Always behave the same to the caller (no enumeration), but only
  // actually re-issue when there is a Pending user.
  if (!user || user.status !== "Pending") {
    return { emailVerificationToken: null };
  }
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + opts.verifyTtlHours * 60 * 60 * 1000);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerificationTokenHash: tokenHash,
      emailVerificationExpiresAt: expiresAt,
    },
  });
  await mail.send(
    buildVerifyEmailMessage({
      appBaseUrl: opts.appBaseUrl,
      email,
      token,
      ttlHours: opts.verifyTtlHours,
    }),
  );
  return { emailVerificationToken: token };
}

function isUniqueConstraintError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) {
    return false;
  }
  const code = (err as { code?: unknown }).code;
  return code === "P2002";
}
