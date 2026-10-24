import {
  registerRecurringSweepHandler,
  shouldDisableInProcessSweeps,
  startIntervalJob,
} from "@agent-native/core/server";
import type {
  IntervalJobHandle,
  RecurringSweepContext,
} from "@agent-native/core/server";

import {
  drainContentWebhookDeliveries,
  purgeSettledContentWebhookDeliveries,
} from "../../actions/_content-webhooks.js";

const SWEEP_INTERVAL_MS = 60_000;
const SWEEP_TIMEOUT_MS = 90_000;
const SWEEP_START_DELAY_MS = 30_000;

let unregisterRecurringSweepHandler: (() => void) | undefined;
let inProcessSweep: IntervalJobHandle | undefined;
let sweepStartTimer: ReturnType<typeof setTimeout> | undefined;

async function runContentWebhookSweep(context: RecurringSweepContext) {
  await drainContentWebhookDeliveries(context);
  await purgeSettledContentWebhookDeliveries();
}

/**
 * Retries webhook deliveries that failed or were never sent, about once a
 * minute: on the platform's scheduled sweep when deployed, and on a timer in
 * a long-running server. Most deliveries go out right after their change
 * commits; this sweep is the guarantee, not the fast path.
 */
export default function registerContentWebhookDelivery(nitroApp?: any) {
  unregisterRecurringSweepHandler ??= registerRecurringSweepHandler(
    "content-webhook-delivery",
    runContentWebhookSweep,
  );

  if (!shouldDisableInProcessSweeps() && !inProcessSweep && !sweepStartTimer) {
    sweepStartTimer = setTimeout(() => {
      sweepStartTimer = undefined;
      inProcessSweep = startIntervalJob(
        (signal) =>
          runContentWebhookSweep({
            deadlineAt: Date.now() + SWEEP_TIMEOUT_MS,
            signal,
          }),
        {
          intervalMs: SWEEP_INTERVAL_MS,
          timeoutMs: SWEEP_TIMEOUT_MS,
          leading: true,
          onError: (error) => {
            console.warn("[content-webhooks] sweep failed:", error);
          },
        },
      );
    }, SWEEP_START_DELAY_MS);
    sweepStartTimer.unref?.();
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
