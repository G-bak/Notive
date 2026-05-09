// Env validation for Phase B step 2.
//
// Single source for the env contract used by apps/web and apps/worker.
// Mirrors docs/operations/notive-deployment-operations-guide-v1.0.md §4.2
// and docs/implementation/notive-implementation-plan-b-service-foundation-v1.0.md §13.7.
//
// Phase B step 2 scope: presence + format validation only. No network
// calls, no business connection. Bootstrap fails fast if any required
// variable is missing or malformed.

import { z, type ZodError } from "zod";

/** Loadable Node.js runtime environments. `test` is for CI / local test runs. */
export const NODE_ENVS = ["development", "staging", "production", "test"] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(NODE_ENVS).default("development"),
  APP_BASE_URL: z.string().url(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

const dbEnvSchema = z.object({
  // Postgres connection string. Format-validated only; no network call.
  DATABASE_URL: z.string().min(1, "required"),
  DIRECT_DATABASE_URL: z.string().min(1, "required"),
});

const redisEnvSchema = z.object({
  // Redis-compatible connection string. Format-validated only.
  REDIS_URL: z.string().min(1, "required"),
});

const sessionEnvSchema = z.object({
  // Phase A §15: server session in Postgres; cookie carries the session id.
  // Secret length lower bound matches operations §4.2 ("32바이트 이상 랜덤").
  SESSION_SECRET: z.string().min(32, "must be at least 32 characters"),
  SESSION_IDLE_TTL_DAYS: z.coerce.number().int().positive().default(14),
  SESSION_ABSOLUTE_TTL_DAYS: z.coerce.number().int().positive().default(30),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(60),
});

const mailEnvSchema = z.object({
  MAIL_PROVIDER_API_KEY: z.string().min(1, "required"),
  MAIL_FROM_ADDRESS: z.string().email(),
  MAIL_VERIFY_TTL_HOURS: z.coerce.number().int().positive().default(24),
  MAIL_INVITE_TTL_DAYS: z.coerce.number().int().positive().default(7),
});

const workerOnlyEnvSchema = z.object({
  // Phase A §15 / Phase B §13.2: cleanup workers default to dry-run.
  // Real destruction only when this flag is exactly the string "true".
  WORKER_DESTRUCTIVE_OPS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  WORKER_RUN_INTERVAL_OVERRIDE: z
    .string()
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
});

/**
 * Web bootstrap env contract.
 * Web serves users, so it needs everything except worker-only knobs.
 */
export const webEnvSchema = baseEnvSchema
  .merge(dbEnvSchema)
  .merge(redisEnvSchema)
  .merge(sessionEnvSchema)
  .merge(mailEnvSchema);

export type WebEnv = z.infer<typeof webEnvSchema>;

/**
 * Worker bootstrap env contract.
 * Worker runs jobs against Postgres and Redis. It does not own user
 * sessions or send mail directly in MVP, so those vars are out of scope
 * here. (If a future job needs them, extend this schema explicitly.)
 */
export const workerEnvSchema = baseEnvSchema
  .merge(dbEnvSchema)
  .merge(redisEnvSchema)
  .merge(workerOnlyEnvSchema);

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

/**
 * Thrown when env validation fails. Carries a list of human-readable
 * `"VAR_NAME: reason"` strings so callers can format consistently.
 */
export class EnvValidationError extends Error {
  readonly target: "web" | "worker";
  readonly issues: ReadonlyArray<string>;

  constructor(target: "web" | "worker", error: ZodError) {
    const issues = error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    });
    super(
      `[env] invalid environment for ${target}:\n${issues.map((line) => `  - ${line}`).join("\n")}`,
    );
    this.name = "EnvValidationError";
    this.target = target;
    this.issues = issues;
  }
}

function loadWith<T extends z.ZodTypeAny>(
  schema: T,
  target: "web" | "worker",
  source: NodeJS.ProcessEnv,
): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(target, result.error);
  }
  return result.data;
}

/**
 * Load and validate the web env. Defaults to `process.env`.
 * Throws `EnvValidationError` on the first call if required vars are
 * missing or malformed; subsequent calls re-validate (callers may cache
 * the result module-side).
 */
export function loadWebEnv(source: NodeJS.ProcessEnv = process.env): WebEnv {
  return loadWith(webEnvSchema, "web", source);
}

/**
 * Load and validate the worker env. Defaults to `process.env`.
 */
export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  return loadWith(workerEnvSchema, "worker", source);
}
