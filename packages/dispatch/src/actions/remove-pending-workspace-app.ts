import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { removePendingWorkspaceApp } from "../server/lib/app-creation-store.js";

export default defineAction({
  description:
    "Remove a pending Builder app entry from the Apps list. Use when the user no longer wants to track a Builder branch in Dispatch (e.g. they abandoned the build). The Builder branch itself is not affected.",
  schema: z.object({
    appId: z
      .string()
      .min(1)
      .max(64)
      .describe("Workspace app id of the pending entry to remove"),
  }),
  run: async (input) => removePendingWorkspaceApp({ appId: input.appId }),
});
