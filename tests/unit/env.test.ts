import { describe, it, expect } from "vitest";
import { EnvValidationError, loadWebEnv, loadWorkerEnv } from "@notive/shared";

const validBase = {
  NODE_ENV: "development",
  APP_BASE_URL: "http://localhost:3000",
  LOG_LEVEL: "info",
};

const validDb = {
  DATABASE_URL: "postgresql://notive:notive@localhost:5432/notive",
  DIRECT_DATABASE_URL: "postgresql://notive:notive@localhost:5432/notive",
};

const validRedis = { REDIS_URL: "redis://localhost:6379" };

const validSession = {
  SESSION_SECRET: "x".repeat(32),
};

const validMail = {
  MAIL_PROVIDER_API_KEY: "test-key",
  MAIL_FROM_ADDRESS: "no-reply@notive.local",
};

const fullWeb = { ...validBase, ...validDb, ...validRedis, ...validSession, ...validMail };

const fullWorker = { ...validBase, ...validDb, ...validRedis };

describe("loadWebEnv", () => {
  it("accepts a fully populated env", () => {
    const env = loadWebEnv(fullWeb as NodeJS.ProcessEnv);
    expect(env.NODE_ENV).toBe("development");
    expect(env.APP_BASE_URL).toBe("http://localhost:3000");
    expect(env.SESSION_IDLE_TTL_DAYS).toBe(14);
    expect(env.SESSION_ABSOLUTE_TTL_DAYS).toBe(30);
    expect(env.PASSWORD_RESET_TTL_MINUTES).toBe(60);
    expect(env.MAIL_VERIFY_TTL_HOURS).toBe(24);
    expect(env.MAIL_INVITE_TTL_DAYS).toBe(7);
  });

  it("throws when SESSION_SECRET is shorter than 32 chars", () => {
    expect(() =>
      loadWebEnv({ ...fullWeb, SESSION_SECRET: "tooshort" } as NodeJS.ProcessEnv),
    ).toThrow(EnvValidationError);
  });

  it("throws when MAIL_FROM_ADDRESS is not an email", () => {
    expect(() =>
      loadWebEnv({ ...fullWeb, MAIL_FROM_ADDRESS: "not-an-email" } as NodeJS.ProcessEnv),
    ).toThrow(EnvValidationError);
  });

  it("throws when DATABASE_URL is missing", () => {
    const broken = { ...fullWeb } as Record<string, string | undefined>;
    delete broken.DATABASE_URL;
    expect(() => loadWebEnv(broken as NodeJS.ProcessEnv)).toThrow(EnvValidationError);
  });

  it("error includes a list of issue strings", () => {
    try {
      loadWebEnv({} as NodeJS.ProcessEnv);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      const issues = (err as EnvValidationError).issues;
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some((line) => line.startsWith("APP_BASE_URL:"))).toBe(true);
    }
  });

  it("coerces numeric overrides", () => {
    const env = loadWebEnv({
      ...fullWeb,
      SESSION_IDLE_TTL_DAYS: "7",
      MAIL_INVITE_TTL_DAYS: "14",
    } as NodeJS.ProcessEnv);
    expect(env.SESSION_IDLE_TTL_DAYS).toBe(7);
    expect(env.MAIL_INVITE_TTL_DAYS).toBe(14);
  });
});

describe("loadWorkerEnv", () => {
  it("accepts the worker baseline", () => {
    const env = loadWorkerEnv(fullWorker as NodeJS.ProcessEnv);
    expect(env.WORKER_DESTRUCTIVE_OPS).toBe(false);
    expect(env.WORKER_RUN_INTERVAL_OVERRIDE).toBeUndefined();
  });

  it("flips WORKER_DESTRUCTIVE_OPS to true only for the literal string 'true'", () => {
    const off = loadWorkerEnv({
      ...fullWorker,
      WORKER_DESTRUCTIVE_OPS: "false",
    } as NodeJS.ProcessEnv);
    expect(off.WORKER_DESTRUCTIVE_OPS).toBe(false);

    const on = loadWorkerEnv({
      ...fullWorker,
      WORKER_DESTRUCTIVE_OPS: "true",
    } as NodeJS.ProcessEnv);
    expect(on.WORKER_DESTRUCTIVE_OPS).toBe(true);
  });

  it("rejects an unknown value for WORKER_DESTRUCTIVE_OPS", () => {
    expect(() =>
      loadWorkerEnv({
        ...fullWorker,
        WORKER_DESTRUCTIVE_OPS: "yes",
      } as NodeJS.ProcessEnv),
    ).toThrow(EnvValidationError);
  });

  it("normalizes empty WORKER_RUN_INTERVAL_OVERRIDE to undefined", () => {
    const env = loadWorkerEnv({
      ...fullWorker,
      WORKER_RUN_INTERVAL_OVERRIDE: "",
    } as NodeJS.ProcessEnv);
    expect(env.WORKER_RUN_INTERVAL_OVERRIDE).toBeUndefined();
  });

  it("does not require web-only vars", () => {
    expect(() => loadWorkerEnv(fullWorker as NodeJS.ProcessEnv)).not.toThrow();
  });
});
