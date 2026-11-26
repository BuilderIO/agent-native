import {
  registerRecurringSweepHandler,
  shouldDisableInProcessSweeps,
  startIntervalJob,
} from "@agent-native/core/server";
import type { IntervalJobHandle } from "@agent-native/core/server";

import { nextColumnFillDueAt, sweepColumnFills } from "../lib/column-fill.js";

const SWEEP_INTERVAL_MS = 30_000;
const SWEEP_TIMEOUT_MS = 90_000;
const SWEEP_START_DELAY_MS = 15_000;

let unregisterRecurringSweepHandler: (() => void) | undefined;
let inProcessSweep: IntervalJobHandle | undefined;
let sweepStartTimer: ReturnType<typeof setTimeout> | undefined;

function unrefTimer(timer: unknown): void {
  if (
    typeof timer === "object" &&
    timer !== null &&
    "unref" in timer &&
    typeof timer.unref === "function"
  ) {
    timer.unref();
  }
}

interface NitroAppCloseHook {
  hooks?: { hook?: (name: "close", handler: () => void) => unknown };
}

export default function registerColumnFillSweep(nitroApp?: NitroAppCloseHook) {
  unregisterRecurringSweepHandler ??= registerRecurringSweepHandler(
    "content-column-fill",
    sweepColumnFills,
    { nextDueAt: nextColumnFillDueAt },
  );

  if (!shouldDisableInProcessSweeps() && !inProcessSweep && !sweepStartTimer) {
    sweepStartTimer = setTimeout(() => {
      sweepStartTimer = undefined;
      inProcessSweep = startIntervalJob(
        (signal) =>
          sweepColumnFills({
            deadlineAt: Date.now() + SWEEP_TIMEOUT_MS,
            signal,
          }),
        {
          intervalMs: SWEEP_INTERVAL_MS,
          timeoutMs: SWEEP_TIMEOUT_MS,
          leading: true,
          onError: (error) => {
            console.warn("[column-fill] sweep failed:", error);
          },
        },
      );
    }, SWEEP_START_DELAY_MS);
    unrefTimer(sweepStartTimer);
  }

  nitroApp?.hooks?.hook?.("close", () => {
    if (sweepStartTimer) clearTimeout(sweepStartTimer);
    sweepStartTimer = undefined;
    void inProcessSweep?.stop();
    inProcessSweep = undefined;
    unregisterRecurringSweepHandler?.();
    unregisterRecurringSweepHandler = undefined;
  });
}
