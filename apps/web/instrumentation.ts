// Next.js calls `register()` once at server start. Importing the env
// module triggers validation; if any required env var is missing or
// malformed, the server fails to start with a clear error.
//
// Build (`next build`) does not run instrumentation, so a missing
// `.env` does not block CI builds — only running servers (`next dev`,
// `next start`) require valid env.

export async function register() {
  await import("./lib/env");
}
