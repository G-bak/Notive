// End-to-end auth flow against the real packages/auth + packages/db.
// These tests do not boot Next.js — they exercise the package functions
// directly. Route-handler wiring is covered by manual review (no
// supertest layer in MVP).

import { describe, it, expect, beforeEach } from "vitest";

import {
  AuthError,
  confirmPasswordReset,
  hashToken,
  login,
  logout,
  requestPasswordReset,
  resendVerification,
  signup,
  validateSession,
  verifyEmail,
} from "@notive/auth";
import { prisma } from "@notive/db";
import { InMemoryMailAdapter } from "@notive/mail";

const APP_BASE_URL = "https://test.notive.local";
const VERIFY_TTL_HOURS = 24;
const RESET_TTL_MINUTES = 60;
const SESSION_TTL = { idleDays: 14, absoluteDays: 30 };

function freshMail(): InMemoryMailAdapter {
  return new InMemoryMailAdapter();
}

function tokenFromBody(body: string): string {
  const m = body.match(/token=([^\s)]+)/);
  if (!m || !m[1]) {
    throw new Error("no token in mail body");
  }
  return decodeURIComponent(m[1]);
}

describe("auth flow", () => {
  let mail: InMemoryMailAdapter;
  beforeEach(() => {
    mail = freshMail();
  });

  it("signup creates a Pending user and stores only the hashed verification token", async () => {
    const email = "alice@example.test";
    const result = await signup(
      prisma,
      mail,
      {
        name: "Alice",
        email,
        password: "Strong!Pass123",
      },
      { appBaseUrl: APP_BASE_URL, verifyTtlHours: VERIFY_TTL_HOURS },
    );

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).not.toBeNull();
    expect(user!.status).toBe("Pending");
    // Hash, not raw token, in DB.
    expect(user!.emailVerificationTokenHash).toBe(hashToken(result.emailVerificationToken));
    expect(user!.emailVerificationTokenHash).not.toBe(result.emailVerificationToken);
    // Password hash is not the raw password.
    expect(user!.passwordHash).not.toContain("Strong!Pass123");
    // Mail captured the token.
    expect(mail.messages).toHaveLength(1);
    expect(mail.messages[0]!.text).toContain(result.emailVerificationToken);
  });

  it("rejects duplicate email at signup", async () => {
    const email = "dup@example.test";
    await signup(
      prisma,
      mail,
      {
        name: "Dup",
        email,
        password: "Strong!Pass123",
      },
      { appBaseUrl: APP_BASE_URL, verifyTtlHours: VERIFY_TTL_HOURS },
    );

    await expect(
      signup(
        prisma,
        mail,
        {
          name: "Dup2",
          email,
          password: "Strong!Pass123",
        },
        { appBaseUrl: APP_BASE_URL, verifyTtlHours: VERIFY_TTL_HOURS },
      ),
    ).rejects.toMatchObject({ code: "EMAIL_TAKEN" });
  });

  it("rejects weak passwords at signup", async () => {
    await expect(
      signup(
        prisma,
        mail,
        {
          name: "Weak",
          email: "weak@example.test",
          password: "short",
        },
        { appBaseUrl: APP_BASE_URL, verifyTtlHours: VERIFY_TTL_HOURS },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("verifyEmail activates the user and clears the token", async () => {
    const email = "verify@example.test";
    const { emailVerificationToken } = await signup(
      prisma,
      mail,
      {
        name: "Verifier",
        email,
        password: "Strong!Pass123",
      },
      { appBaseUrl: APP_BASE_URL, verifyTtlHours: VERIFY_TTL_HOURS },
    );

    await verifyEmail(prisma, { token: emailVerificationToken });

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user!.status).toBe("Active");
    expect(user!.emailVerifiedAt).not.toBeNull();
    expect(user!.emailVerificationTokenHash).toBeNull();
    expect(user!.emailVerificationExpiresAt).toBeNull();
  });

  it("verifyEmail rejects an unknown token", async () => {
    await expect(verifyEmail(prisma, { token: "definitely-not-issued" })).rejects.toMatchObject({
      code: "TOKEN_INVALID",
    });
  });

  it("verifyEmail rejects an expired token", async () => {
    const email = "expired@example.test";
    const { emailVerificationToken } = await signup(
      prisma,
      mail,
      {
        name: "Expired",
        email,
        password: "Strong!Pass123",
      },
      { appBaseUrl: APP_BASE_URL, verifyTtlHours: VERIFY_TTL_HOURS },
    );
    // Force the token to be expired.
    await prisma.user.update({
      where: { email },
      data: { emailVerificationExpiresAt: new Date(Date.now() - 60_000) },
    });
    await expect(verifyEmail(prisma, { token: emailVerificationToken })).rejects.toMatchObject({
      code: "TOKEN_EXPIRED",
    });
  });

  it("login + /me + logout end to end", async () => {
    const email = "flow@example.test";
    const password = "Strong!Pass123";
    const { emailVerificationToken } = await signup(
      prisma,
      mail,
      {
        name: "Flow",
        email,
        password,
      },
      { appBaseUrl: APP_BASE_URL, verifyTtlHours: VERIFY_TTL_HOURS },
    );
    await verifyEmail(prisma, { token: emailVerificationToken });

    const { token, session } = await login(prisma, { email, password }, { ttl: SESSION_TTL });

    // Token is opaque, not a Prisma id.
    expect(token).not.toEqual(session.id);
    // DB stores the hash, not the token.
    const stored = await prisma.session.findUnique({ where: { id: session.id } });
    expect(stored!.tokenHash).toBe(hashToken(token));
    expect(stored!.tokenHash).not.toBe(token);

    // Validation succeeds.
    const v = await validateSession(prisma, token, SESSION_TTL);
    expect(v.user.email).toBe(email);

    // Logout revokes the session.
    await logout(prisma, token);
    await expect(validateSession(prisma, token, SESSION_TTL)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("login fails with wrong password", async () => {
    const email = "wrongpw@example.test";
    const { emailVerificationToken } = await signup(
      prisma,
      mail,
      {
        name: "WrongPW",
        email,
        password: "Strong!Pass123",
      },
      { appBaseUrl: APP_BASE_URL, verifyTtlHours: VERIFY_TTL_HOURS },
    );
    await verifyEmail(prisma, { token: emailVerificationToken });
    await expect(
      login(prisma, { email, password: "Wrong!Pass1234" }, { ttl: SESSION_TTL }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("login fails with unknown email and returns INVALID_CREDENTIALS (no enumeration)", async () => {
    await expect(
      login(prisma, { email: "ghost@example.test", password: "anything12" }, { ttl: SESSION_TTL }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("login on a Pending user reports EMAIL_NOT_VERIFIED only after correct password", async () => {
    const email = "pending@example.test";
    const password = "Strong!Pass123";
    await signup(
      prisma,
      mail,
      {
        name: "Pending",
        email,
        password,
      },
      { appBaseUrl: APP_BASE_URL, verifyTtlHours: VERIFY_TTL_HOURS },
    );
    // Wrong password on Pending user must look the same as wrong-password-on-active.
    await expect(
      login(prisma, { email, password: "Wrong!Pass1234" }, { ttl: SESSION_TTL }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    // Correct password on Pending user surfaces EMAIL_NOT_VERIFIED.
    await expect(login(prisma, { email, password }, { ttl: SESSION_TTL })).rejects.toMatchObject({
      code: "EMAIL_NOT_VERIFIED",
    });
  });

  it("session validation rejects a Disabled user even with a still-valid session", async () => {
    const email = "disable@example.test";
    const password = "Strong!Pass123";
    const { emailVerificationToken } = await signup(
      prisma,
      mail,
      {
        name: "ToDisable",
        email,
        password,
      },
      { appBaseUrl: APP_BASE_URL, verifyTtlHours: VERIFY_TTL_HOURS },
    );
    await verifyEmail(prisma, { token: emailVerificationToken });
    const { token } = await login(prisma, { email, password }, { ttl: SESSION_TTL });

    await prisma.user.update({ where: { email }, data: { status: "Disabled" } });
    await expect(validateSession(prisma, token, SESSION_TTL)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("session validation rejects an expired session", async () => {
    const email = "expsession@example.test";
    const password = "Strong!Pass123";
    const { emailVerificationToken } = await signup(
      prisma,
      mail,
      {
        name: "ExpSession",
        email,
        password,
      },
      { appBaseUrl: APP_BASE_URL, verifyTtlHours: VERIFY_TTL_HOURS },
    );
    await verifyEmail(prisma, { token: emailVerificationToken });
    const { token, session } = await login(prisma, { email, password }, { ttl: SESSION_TTL });
    await prisma.session.update({
      where: { id: session.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await expect(validateSession(prisma, token, SESSION_TTL)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  // §16.1 "Cannot log in to a Disabled account."
  it("login on a Disabled user reports ACCOUNT_DISABLED only after correct password", async () => {
    // Email is normalized to lowercase by signup; the lookup must
    // match that exact form.
    const email = "logindisabled@example.test";
    const password = "Strong!Pass123";
    const { emailVerificationToken } = await signup(
      prisma,
      mail,
      { name: "LoginDis", email, password },
      { appBaseUrl: APP_BASE_URL, verifyTtlHours: VERIFY_TTL_HOURS },
    );
    await verifyEmail(prisma, { token: emailVerificationToken });
    await prisma.user.update({ where: { email }, data: { status: "Disabled" } });
    // Wrong password on a Disabled account must look identical to the
    // wrong-password-on-Active path (no enumeration).
    await expect(
      login(prisma, { email, password: "Wrong!Pass1234" }, { ttl: SESSION_TTL }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    // Correct password on a Disabled account surfaces ACCOUNT_DISABLED.
    await expect(login(prisma, { email, password }, { ttl: SESSION_TTL })).rejects.toMatchObject({
      code: "ACCOUNT_DISABLED",
    });
  });

  // §16.1 "Session expires after the configured idle / absolute window."
  // Idle expiry is covered above; this case pins the *absolute* cap.
  // The implementation enforces the cap through renewal clamping rather
  // than a wall-clock check: validateSession never extends `expires_at`
  // past `created_at + absoluteDays`. So the *next* validation after
  // the renewal sees `expires_at` clamped into the past and rejects.
  it("session validation clamps renewal to the absolute TTL cap", async () => {
    const email = "abscap@example.test";
    const password = "Strong!Pass123";
    const { emailVerificationToken } = await signup(
      prisma,
      mail,
      { name: "AbsCap", email, password },
      { appBaseUrl: APP_BASE_URL, verifyTtlHours: VERIFY_TTL_HOURS },
    );
    await verifyEmail(prisma, { token: emailVerificationToken });
    const { token, session } = await login(prisma, { email, password }, { ttl: SESSION_TTL });
    // Move createdAt past the absolute cap. Stored expiresAt is still
    // in the future from the initial login, so the first validate
    // succeeds but the renewal clamps expiresAt to createdAt + abs
    // (which is now in the past).
    const farPast = new Date(Date.now() - (SESSION_TTL.absoluteDays + 1) * 24 * 60 * 60 * 1000);
    await prisma.session.update({
      where: { id: session.id },
      data: { createdAt: farPast },
    });

    await validateSession(prisma, token, SESSION_TTL);
    const renewed = await prisma.session.findUnique({ where: { id: session.id } });
    const absoluteCapMs = farPast.getTime() + SESSION_TTL.absoluteDays * 24 * 60 * 60 * 1000;
    expect(renewed!.expiresAt.getTime()).toBeLessThanOrEqual(absoluteCapMs);
    expect(renewed!.expiresAt.getTime()).toBeLessThan(Date.now());

    // The next validation must reject — expiresAt is now in the past.
    await expect(validateSession(prisma, token, SESSION_TTL)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("password reset: request + confirm replaces password and revokes existing sessions", async () => {
    const email = "reset@example.test";
    const oldPassword = "Strong!Pass123";
    const { emailVerificationToken } = await signup(
      prisma,
      mail,
      {
        name: "Resetter",
        email,
        password: oldPassword,
      },
      { appBaseUrl: APP_BASE_URL, verifyTtlHours: VERIFY_TTL_HOURS },
    );
    await verifyEmail(prisma, { token: emailVerificationToken });
    const { token: oldSessionToken } = await login(
      prisma,
      { email, password: oldPassword },
      { ttl: SESSION_TTL },
    );

    const reqMail = freshMail();
    const { passwordResetToken } = await requestPasswordReset(
      prisma,
      reqMail,
      { email },
      {
        appBaseUrl: APP_BASE_URL,
        ttlMinutes: RESET_TTL_MINUTES,
      },
    );
    expect(passwordResetToken).not.toBeNull();
    // Mail body should carry the same token.
    const body = reqMail.lastTo(email)!.text;
    expect(tokenFromBody(body)).toBe(passwordResetToken!);

    const newPassword = "BrandNew!Pass456";
    await confirmPasswordReset(prisma, { token: passwordResetToken!, newPassword });

    // Old session is revoked.
    await expect(validateSession(prisma, oldSessionToken, SESSION_TTL)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    // Old password no longer logs in.
    await expect(
      login(prisma, { email, password: oldPassword }, { ttl: SESSION_TTL }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    // New password works.
    const { token: newToken } = await login(
      prisma,
      { email, password: newPassword },
      { ttl: SESSION_TTL },
    );
    const v = await validateSession(prisma, newToken, SESSION_TTL);
    expect(v.user.email).toBe(email);
  });

  it("password reset request for an unknown email returns success without sending mail (no enumeration)", async () => {
    const m = freshMail();
    const { passwordResetToken } = await requestPasswordReset(
      prisma,
      m,
      { email: "nobody@example.test" },
      { appBaseUrl: APP_BASE_URL, ttlMinutes: RESET_TTL_MINUTES },
    );
    expect(passwordResetToken).toBeNull();
    expect(m.messages).toHaveLength(0);
  });

  it("password reset confirm rejects an expired token", async () => {
    const email = "rstexp@example.test";
    const password = "Strong!Pass123";
    const { emailVerificationToken } = await signup(
      prisma,
      mail,
      {
        name: "RstExp",
        email,
        password,
      },
      { appBaseUrl: APP_BASE_URL, verifyTtlHours: VERIFY_TTL_HOURS },
    );
    await verifyEmail(prisma, { token: emailVerificationToken });

    const { passwordResetToken } = await requestPasswordReset(
      prisma,
      mail,
      { email },
      {
        appBaseUrl: APP_BASE_URL,
        ttlMinutes: RESET_TTL_MINUTES,
      },
    );
    await prisma.user.update({
      where: { email },
      data: { passwordResetExpiresAt: new Date(Date.now() - 60_000) },
    });
    await expect(
      confirmPasswordReset(prisma, { token: passwordResetToken!, newPassword: "BrandNew!9999" }),
    ).rejects.toMatchObject({ code: "TOKEN_EXPIRED" });
  });

  it("resend verification re-issues a token for a Pending user and is a no-op for unknown emails", async () => {
    const email = "rsd@example.test";
    const r1 = await signup(
      prisma,
      mail,
      {
        name: "Resender",
        email,
        password: "Strong!Pass123",
      },
      { appBaseUrl: APP_BASE_URL, verifyTtlHours: VERIFY_TTL_HOURS },
    );

    const m2 = freshMail();
    const r2 = await resendVerification(
      prisma,
      m2,
      { email },
      {
        appBaseUrl: APP_BASE_URL,
        verifyTtlHours: VERIFY_TTL_HOURS,
      },
    );
    expect(r2.emailVerificationToken).not.toBeNull();
    expect(r2.emailVerificationToken).not.toEqual(r1.emailVerificationToken);
    // Old token no longer works.
    await expect(verifyEmail(prisma, { token: r1.emailVerificationToken })).rejects.toBeInstanceOf(
      AuthError,
    );
    // New token works.
    await verifyEmail(prisma, { token: r2.emailVerificationToken! });

    // Unknown email is silent.
    const m3 = freshMail();
    const r3 = await resendVerification(
      prisma,
      m3,
      { email: "ghost2@example.test" },
      {
        appBaseUrl: APP_BASE_URL,
        verifyTtlHours: VERIFY_TTL_HOURS,
      },
    );
    expect(r3.emailVerificationToken).toBeNull();
    expect(m3.messages).toHaveLength(0);
  });
});
