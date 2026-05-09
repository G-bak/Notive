// Server-side session lifecycle.
//
// Phase A §15 lock: sessions live in Postgres (table `sessions`). The
// cookie carries the raw token; only the sha256 hash is stored. Each
// request looks the session up by `token_hash`, verifies it has not
// expired or been revoked, and re-checks `users.status === 'Active'`.
// A user disabled or deleted between requests is rejected immediately.
//
// Idle vs absolute TTL:
//   - SESSION_IDLE_TTL_DAYS resets on each successful validation.
//   - SESSION_ABSOLUTE_TTL_DAYS caps total session age regardless of
//     activity. We compute `expires_at = min(now+idle, created_at+abs)`
//     so renewal can never push past the absolute cap.

import type { PrismaClient, Session, User } from "@notive/db";

import { AuthError } from "./errors.js";
import { generateToken, hashToken } from "./tokens.js";

export interface SessionTtl {
  idleDays: number;
  absoluteDays: number;
}

export interface CreateSessionResult {
  /** The raw session token to set as a cookie. Never persisted. */
  token: string;
  session: Session;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function clampToAbsolute(now: Date, createdAt: Date, ttl: SessionTtl): Date {
  const idleExpiry = new Date(now.getTime() + ttl.idleDays * MS_PER_DAY);
  const absoluteCap = new Date(createdAt.getTime() + ttl.absoluteDays * MS_PER_DAY);
  return idleExpiry < absoluteCap ? idleExpiry : absoluteCap;
}

export async function createSession(
  prisma: PrismaClient,
  userId: string,
  ttl: SessionTtl,
  now: Date = new Date(),
): Promise<CreateSessionResult> {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = clampToAbsolute(now, now, ttl);
  const session = await prisma.session.create({
    data: { userId, tokenHash, expiresAt },
  });
  return { token, session };
}

export interface ValidatedSession {
  session: Session;
  user: User;
}

/**
 * Resolve a raw cookie token to the active user.
 *
 * Returns the session+user on success; throws `AuthError(UNAUTHORIZED)`
 * if the token is unknown, expired, revoked, or belongs to a non-Active
 * user. On success, the session's `expiresAt` is renewed via the idle
 * TTL (capped to absolute TTL).
 */
export async function validateSession(
  prisma: PrismaClient,
  token: string,
  ttl: SessionTtl,
  now: Date = new Date(),
): Promise<ValidatedSession> {
  if (!token) {
    throw new AuthError("UNAUTHORIZED", "no session token");
  }
  const tokenHash = hashToken(token);
  const found = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!found) {
    throw new AuthError("UNAUTHORIZED", "session not found");
  }
  if (found.revokedAt) {
    throw new AuthError("UNAUTHORIZED", "session revoked");
  }
  if (found.expiresAt.getTime() <= now.getTime()) {
    throw new AuthError("UNAUTHORIZED", "session expired");
  }
  if (found.user.status !== "Active") {
    throw new AuthError("UNAUTHORIZED", "account not active");
  }

  // Idle renewal, capped to absolute TTL.
  const renewedExpiresAt = clampToAbsolute(now, found.createdAt, ttl);
  // Avoid a write per request when the change would be sub-minute; we
  // still update if the renewal extends or shortens by >= 60s.
  const drift = Math.abs(renewedExpiresAt.getTime() - found.expiresAt.getTime());
  let session = found;
  if (drift >= 60_000) {
    session = await prisma.session.update({
      where: { id: found.id },
      data: { expiresAt: renewedExpiresAt },
      include: { user: true },
    });
  }
  return { session, user: found.user };
}

export async function revokeSessionByToken(
  prisma: PrismaClient,
  token: string,
  now: Date = new Date(),
): Promise<void> {
  if (!token) {
    return;
  }
  const tokenHash = hashToken(token);
  // updateMany: silently no-op if the row is gone or already revoked.
  await prisma.session.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: now },
  });
}

export async function revokeAllSessionsForUser(
  prisma: PrismaClient,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now },
  });
}
