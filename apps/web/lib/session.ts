// Web-side session cookie wrapper.
//
// The cookie carries the raw session token; only the sha256 hash lives
// in Postgres. Callers either:
//   - call `getCurrentSession(cookies())` for protected route handlers
//     (returns ValidatedSession or throws AuthError UNAUTHORIZED), or
//   - call `setSessionCookie` / `clearSessionCookie` after login/logout.
//
// Cookie options:
//   - HttpOnly: yes — JS must not read it.
//   - SameSite: Lax — login flow tolerates same-site nav.
//   - Secure: in non-development envs.
//   - Path: "/" so all routes can read it.

import { AuthError, type SessionTtl, type ValidatedSession, validateSession } from "@notive/auth";
import { prisma } from "@notive/db";
import type { ResponseCookies } from "next/dist/compiled/@edge-runtime/cookies";
import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";

import { getEnv } from "./env";

export const SESSION_COOKIE = "notive_session";

export function sessionTtl(): SessionTtl {
  const env = getEnv();
  return {
    idleDays: env.SESSION_IDLE_TTL_DAYS,
    absoluteDays: env.SESSION_ABSOLUTE_TTL_DAYS,
  };
}

export async function getCurrentSession(
  cookieJar: Pick<ReadonlyRequestCookies, "get">,
): Promise<ValidatedSession> {
  const raw = cookieJar.get(SESSION_COOKIE)?.value;
  if (!raw) {
    throw new AuthError("UNAUTHORIZED", "no session cookie");
  }
  return validateSession(prisma, raw, sessionTtl());
}

export async function tryGetCurrentSession(
  cookieJar: Pick<ReadonlyRequestCookies, "get">,
): Promise<ValidatedSession | null> {
  try {
    return await getCurrentSession(cookieJar);
  } catch (err) {
    if (err instanceof AuthError && err.code === "UNAUTHORIZED") {
      return null;
    }
    throw err;
  }
}

export function setSessionCookie(
  cookieJar: Pick<ResponseCookies, "set">,
  token: string,
  expiresAt: Date,
): void {
  const env = getEnv();
  cookieJar.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV !== "development",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(cookieJar: Pick<ResponseCookies, "set">): void {
  const env = getEnv();
  cookieJar.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV !== "development",
    path: "/",
    maxAge: 0,
  });
}
