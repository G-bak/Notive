// Notive worker entrypoint.
// Phase B: framework + dry-run only. No business jobs registered yet.
// See docs/implementation/notive-implementation-plan-b-service-foundation-v1.0.md section 13.2.

import { APP_NAME } from "@notive/shared";

const destructiveOpsEnabled = process.env.WORKER_DESTRUCTIVE_OPS === "true";

function log(message: string): void {
  // Minimal logger placeholder; replaced with a real logger in step 1+.
  // eslint-disable-next-line no-console
  console.log(`[${APP_NAME}/worker] ${message}`);
}

export async function runWorker(): Promise<void> {
  log("starting");
  log(`destructive ops: ${destructiveOpsEnabled ? "ENABLED" : "dry-run"}`);
  log("no jobs registered (Phase B)");
  log("exiting (Phase B framework smoke)");
}

runWorker().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
