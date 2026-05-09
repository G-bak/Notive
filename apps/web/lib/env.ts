// Web bootstrap env contract.
//
// Importing this module triggers validation against process.env. If any
// required variable is missing or malformed, a clear `EnvValidationError`
// is thrown — by design, this fails the server start. There is no
// silent fallback for a missing required var.
//
// Re-export the validated, typed env so app code can access values
// through `import { env } from "@/lib/env"`.

import { loadWebEnv, type WebEnv } from "@notive/shared";

let cached: WebEnv | undefined;

function load(): WebEnv {
  if (cached) {
    return cached;
  }
  cached = loadWebEnv();
  return cached;
}

export const env: WebEnv = load();
