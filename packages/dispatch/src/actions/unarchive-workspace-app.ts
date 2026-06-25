import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { unarchiveWorkspaceApp } from "../server/lib/app-creation-store.js";

export default defineAction({
  description:
    "Restore a previously archived workspace app to the Apps list for the current viewer.",
  schema: z.object({
    appId: z
      .string()
      .min(1)
      .max(64)
      .describe("Workspace app id (matches the apps/<id>/ folder)"),
  }),
  run: async (input) => unarchiveWorkspaceApp({ appId: input.appId }),
});
