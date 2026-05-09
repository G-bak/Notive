// Web bootstrap env contract.
//
// `getEnv()` validates against process.env on first call and caches the
// result. Importing this module alone must not validate: Next.js imports
// route modules during `next build`, and CI builds should not require a
// real runtime `.env`. Server startup validation is triggered explicitly
// from `instrumentation.ts`.

import { loadWebEnv, type WebEnv } from "@notive/shared";

let cached: WebEnv | undefined;

export function getEnv(): WebEnv {
  if (cached) {
    return cached;
  }
  cached = loadWebEnv();
  return cached;
}
