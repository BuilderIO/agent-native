/**
 * Recovers server stitches (server/lib/stitch-job.ts): dispatches queued
 * stitches and stitches whose worker died once their lease ran out, and fails
 * those that ran out of attempts. Serverless hosts run it on the recurring
 * sweep tick; long-lived servers, which do not run that tick, every minute.
 */
import {
  defineNitroPlugin,
  registerRecurringSweepHandler,
} from "@agent-native/core/server";

import { recoverStitchJobs } from "../lib/stitch-job.js";

const STARTUP_DELAY_MS = 30_000;
const SWEEP_INTERVAL_MS = 60_000;

let inFlight = false;

async function sweep(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const { dispatched, failed } = await recoverStitchJobs();
    if (dispatched > 0 || failed > 0) {
      console.log("[stitch-job] recovery sweep", { dispatched, failed });
    }
  } catch (error: unknown) {
    console.warn("[stitch-job] recovery sweep failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    inFlight = false;
  }
}

export default defineNitroPlugin(() => {
  registerRecurringSweepHandler("clips-stitch-jobs", async () => {
    await recoverStitchJobs();
  });
  const timer = setTimeout(() => {
    void sweep();
    const interval = setInterval(() => void sweep(), SWEEP_INTERVAL_MS);
    interval.unref();
  }, STARTUP_DELAY_MS);
  timer.unref();
});
