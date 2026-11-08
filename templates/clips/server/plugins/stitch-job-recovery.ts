/**
 * Server stitches run in this process (server/lib/stitch-job.ts), so a
 * restart drops any that were running. Shortly after start, stitched
 * recordings still `processing` after two hours are marked failed instead of
 * spinning forever. The sweep repeats every 30 minutes, so a stitch dropped
 * by a deploy does not wait for the next restart to be cleaned up.
 */
import { defineNitroPlugin } from "@agent-native/core/server";

import { failStaleStitchJobs } from "../lib/stitch-job.js";

const STARTUP_DELAY_MS = 30_000;
const SWEEP_INTERVAL_MS = 30 * 60_000;

function sweep(): void {
  failStaleStitchJobs()
    .then((count) => {
      if (count > 0) {
        console.log(`[stitch-job] marked ${count} stale stitch(es) failed`);
      }
    })
    .catch((error: unknown) => {
      console.warn("[stitch-job] stale stitch recovery failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

export default defineNitroPlugin(() => {
  const timer = setTimeout(sweep, STARTUP_DELAY_MS);
  timer.unref?.();
  const interval = setInterval(sweep, SWEEP_INTERVAL_MS);
  interval.unref?.();
});
