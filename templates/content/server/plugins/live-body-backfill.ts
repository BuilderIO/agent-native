import {
  defineNitroPlugin,
  registerRecurringSweepHandler,
} from "@agent-native/core/server";

import {
  LIVE_BODY_BACKFILL_SWEEP_ID,
  runLiveBodyBackfillSweep,
} from "../live-copy/backfill.js";

/**
 * Switches idle pages to their live copy on the platform's scheduled sweep.
 * It reads no pages while no one has the backfill flag on.
 */
export function registerLiveBodyBackfillSweep() {
  return registerRecurringSweepHandler(
    LIVE_BODY_BACKFILL_SWEEP_ID,
    async ({ deadlineAt, signal }) => {
      await runLiveBodyBackfillSweep({ deadlineAt, signal });
    },
  );
}

export default defineNitroPlugin(() => {
  registerLiveBodyBackfillSweep();
});
