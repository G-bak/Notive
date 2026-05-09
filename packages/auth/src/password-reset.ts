// Password reset request + confirm.
//
// Request:
//   - looks up by email; if found and Active, issues a token and emails it.
//   - if not found / not Active, returns the same shape (no enumeration).
//
// Confirm:
//   - looks up by token hash, checks expiry, replaces password hash,
//     clears the reset token, revokes all existing sessions for that
//     user (force re-login).

import type { PrismaClient } from "@notive/db";
import { type MailAdapter, buildPasswordResetMessage } from "@notive/mail";
import { z } from "zod";

import { AuthError } from "./errors.js";
import { hashPassword } from "./password.js";
import { revokeAllSessionsForUser } from "./session.js";
import { generateToken, hashToken } from "./tokens.js";

export const requestResetInputSchema = z.object({
  email: z.string().trim().email().max(254),
});
export type RequestResetInput = z.infer<typeof requestResetInputSchema>;

export interface PasswordResetOptions {
  appBaseUrl: string;
  ttlMinutes: number;
}

export interface RequestResetResult {
  /** Raw token if a reset was actually issued; null otherwise. */
  passwordResetToken: string | null;
}

export async function requestPasswordReset(
  prisma: PrismaClient,
  mail: MailAdapter,
  rawInput: unknown,
  opts: PasswordResetOptions,
): Promise<RequestResetResult> {
  const parsed = requestResetInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new AuthError("INVALID_INPUT", "invalid email");
  }
  const email = parsed.data.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.status !== "Active") {
    return { passwordResetToken: null };
  }
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + opts.ttlMinutes * 60 * 1000);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: expiresAt,
    },
  });
  await mail.send(
    buildPasswordResetMessage({
      appBaseUrl: opts.appBaseUrl,
      email,
      token,
      ttlMinutes: opts.ttlMinutes,
    }),
  );
  return { passwordResetToken: token };
}

export const confirmResetInputSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string(),
});
export type ConfirmResetInput = z.infer<typeof confirmResetInputSchema>;

export async function confirmPasswordReset(
  prisma: PrismaClient,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<{ userId: string }> {
  const parsed = confirmResetInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new AuthError("INVALID_INPUT", "invalid input");
  }
  const tokenHash = hashToken(parsed.data.token);
  const user = await prisma.user.findUnique({ where: { passwordResetTokenHash: tokenHash } });
  if (!user) {
    throw new AuthError("TOKEN_INVALID", "reset token not recognized");
  }
  if (!user.passwordResetExpiresAt || user.passwordResetExpiresAt.getTime() <= now.getTime()) {
    throw new AuthError("TOKEN_EXPIRED", "reset token expired");
  }
  if (user.status !== "Active") {
    throw new AuthError("ACCOUNT_DISABLED", "account is not active");
  }

  const newHash = await hashPassword(parsed.data.newPassword);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: newHash,
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
    },
  });
  // Force re-login on every device.
  await revokeAllSessionsForUser(prisma, user.id, now);
  return { userId: user.id };
}
