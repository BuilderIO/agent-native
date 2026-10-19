import { registerRecurringSweepHandler } from "@agent-native/core/server";

import { sweepOrphanedUploadedAssetObjects } from "../handlers/assets.js";

let unregisterSweepHandler: (() => void) | undefined;

export default function registerOrphanedAssetCleanup(nitroApp?: any) {
  unregisterSweepHandler ??= registerRecurringSweepHandler(
    "slides-2-orphaned-asset-cleanup",
    sweepOrphanedUploadedAssetObjects,
  );

  nitroApp?.hooks?.hook?.("close", () => {
    unregisterSweepHandler?.();
    unregisterSweepHandler = undefined;
  });
}
