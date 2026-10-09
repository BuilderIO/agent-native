import {
  registerRecurringSweepHandler,
  scheduledTriggerAvailability,
  type RecurringSweepContext,
} from "@agent-native/core/server";
import { startIntervalJob } from "@agent-native/core/server/interval-job";

import { sweepExpiredJourneyCanvasStages } from "../lib/journey-canvas-stage-cleanup.js";

const INTERVAL_MS = 5 * 60_000;
const runRegisteredCleanup = async (context: RecurringSweepContext) => {
  await sweepExpiredJourneyCanvasStages(context.signal);
};
let unregisterRecurringSweepHandler: (() => void) | undefined;

export default function registerJourneyCanvasStageCleanup() {
  unregisterRecurringSweepHandler ??= registerRecurringSweepHandler(
    "design-journey-canvas-stage-cleanup",
    runRegisteredCleanup,
  );
  const availability = scheduledTriggerAvailability();
  if (!availability.available || availability.driver !== "in-process") return;
  startIntervalJob(
    async () => {
      await sweepExpiredJourneyCanvasStages();
    },
    {
      intervalMs: INTERVAL_MS,
      leading: false,
      onError: (error) =>
        console.error("[design-journey-canvas-stage-cleanup] failed:", error),
    },
  );
}
