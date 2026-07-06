import { defineAction } from "@agent-native/core";

import { syncSource, syncSourceInputSchema } from "../server/lib/sync.js";

export default defineAction({
  description:
    "Sync a delivery provider window by ingesting already-normalized work items into Delivery Workbench and updating the provider cursor.",
  schema: syncSourceInputSchema,
  run: syncSource,
});
