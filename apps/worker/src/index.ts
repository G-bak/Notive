// Notive worker entrypoint.
// Phase B: framework + dry-run only. No business jobs registered yet.
// See docs/implementation/notive-implementation-plan-b-service-foundation-v1.0.md section 13.2.

import { APP_NAME } from "@notive/shared";
import { env } from "./env.js";

function log(message: string): void {
  // Minimal logger placeholder; a real logger lands in a later step.
  // eslint-disable-next-line no-console
  console.log(`[${APP_NAME}/worker] ${message}`);
}

export async function runWorker(): Promise<void> {
  log(`starting (env=${env.NODE_ENV}, log_level=${env.LOG_LEVEL})`);
  log(`destructive ops: ${env.WORKER_DESTRUCTIVE_OPS ? "ENABLED" : "dry-run"}`);
  if (env.WORKER_RUN_INTERVAL_OVERRIDE) {
    log(`cron interval override: ${env.WORKER_RUN_INTERVAL_OVERRIDE}`);
  }
  log("no jobs registered (Phase B)");
  log("exiting (Phase B framework smoke)");
}

runWorker().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
