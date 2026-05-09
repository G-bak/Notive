// Worker bootstrap env contract.
//
// Importing this module triggers validation against process.env. If any
// required variable is missing or malformed, an `EnvValidationError` is
// thrown and the worker process exits before doing any work.

import { loadWorkerEnv, type WorkerEnv } from "@notive/shared";

let cached: WorkerEnv | undefined;

function load(): WorkerEnv {
  if (cached) {
    return cached;
  }
  cached = loadWorkerEnv();
  return cached;
}

export const env: WorkerEnv = load();
