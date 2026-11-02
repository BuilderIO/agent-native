import {
  defineNitroPlugin,
  registerRecurringSweepHandler,
} from "@agent-native/core/server";

import { runRecordingMediaCleanupSweep } from "../lib/recording-media-cleanup-worker.js";

export default defineNitroPlugin(() => {
  registerRecurringSweepHandler(
    "clips-recording-media-cleanup",
    runRecordingMediaCleanupSweep,
  );
});
