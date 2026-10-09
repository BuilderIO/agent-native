import {
  registerRecurringSweepHandler,
  shouldDisableInProcessSweeps,
  startIntervalJob,
} from "@agent-native/core/server";
import type { IntervalJobHandle } from "@agent-native/core/server";

import { runJourneyCanvasStageCleanupSweep } from "../lib/journey-canvas-stage-cleanup.js";

let unregisterRecurringSweepHandler: (() => void) | undefined;
let inProcessCleanup: IntervalJobHandle | undefined;

const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const CLEANUP_START_DELAY_MS = 30_000;
const CLEANUP_TIMEOUT_MS = 5 * 60 * 1_000;
let cleanupStartTimer: ReturnType<typeof setTimeout> | undefined;

export default function registerJourneyCanvasStageCleanup(nitroApp?: any) {
  unregisterRecurringSweepHandler ??= registerRecurringSweepHandler(
    "design-journey-canvas-stage-cleanup",
    runJourneyCanvasStageCleanupSweep,
  );

  if (
    !shouldDisableInProcessSweeps() &&
    !inProcessCleanup &&
    !cleanupStartTimer
  ) {
    cleanupStartTimer = setTimeout(() => {
      cleanupStartTimer = undefined;
      inProcessCleanup = startIntervalJob(
        (signal) =>
          runJourneyCanvasStageCleanupSweep({
            deadlineAt: Date.now() + CLEANUP_TIMEOUT_MS,
            signal,
          }),
        {
          intervalMs: CLEANUP_INTERVAL_MS,
          timeoutMs: CLEANUP_TIMEOUT_MS,
          leading: true,
          onError: (error) => {
            console.warn(
              "[design-journey-canvas-stage-cleanup] In-process sweep failed:",
              error,
            );
          },
        },
      );
    }, CLEANUP_START_DELAY_MS);
    cleanupStartTimer.unref?.();
  }

  nitroApp?.hooks?.hook?.("close", () => {
    if (cleanupStartTimer) clearTimeout(cleanupStartTimer);
    cleanupStartTimer = undefined;
    inProcessCleanup?.stop();
    inProcessCleanup = undefined;
    unregisterRecurringSweepHandler?.();
    unregisterRecurringSweepHandler = undefined;
  });
}
