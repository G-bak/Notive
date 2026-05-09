import { describe, it, expect } from "vitest";

import {
  AuthError,
  PASSWORD_MIN_LENGTH,
  hashPassword,
  validatePasswordPolicy,
  verifyPassword,
} from "@notive/auth";

describe("password policy", () => {
  it("rejects passwords shorter than the minimum", () => {
    expect(() => validatePasswordPolicy("a1b")).toThrowError(AuthError);
  });

  it("rejects passwords with no digit", () => {
    expect(() => validatePasswordPolicy("abcdefghijk")).toThrowError(AuthError);
  });

  it("rejects passwords with no letter", () => {
    expect(() => validatePasswordPolicy("12345678901")).toThrowError(AuthError);
  });

  it("accepts a passing password", () => {
    expect(() => validatePasswordPolicy("a".repeat(PASSWORD_MIN_LENGTH - 1) + "1")).not.toThrow();
  });
});

describe("password hashing", () => {
  it("verifies a correct password", async () => {
    const hash = await hashPassword("Correct!1234");
    expect(await verifyPassword("Correct!1234", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("Correct!1234");
    expect(await verifyPassword("Different!1234", hash)).toBe(false);
  });

  it("does not store the raw password in the hash string", async () => {
    const password = "Secret!9999";
    const hash = await hashPassword(password);
    expect(hash.includes(password)).toBe(false);
  });

  it("produces different hashes for the same password (salted)", async () => {
    const a = await hashPassword("Same!1234567");
    const b = await hashPassword("Same!1234567");
    expect(a).not.toEqual(b);
  });
});
