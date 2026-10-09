import { registerRecurringSweepHandler } from "@agent-native/core/server";

import { runJourneyCanvasStageCleanupSweep } from "../lib/journey-canvas-stage-cleanup.js";

let unregisterRecurringSweepHandler: (() => void) | undefined;

export default function registerJourneyCanvasStageCleanup() {
  unregisterRecurringSweepHandler ??= registerRecurringSweepHandler(
    "design-journey-canvas-stage-cleanup",
    runJourneyCanvasStageCleanupSweep,
  );
}
