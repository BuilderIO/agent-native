import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { archiveWorkspaceApp } from "../server/lib/app-creation-store.js";

export default defineAction({
  description:
    "Hide a workspace app from the Apps list for the current viewer. The app's files and database stay intact; this is a per-user/org visibility flag stored in dispatch settings. Pair with unarchive-workspace-app to restore.",
  schema: z.object({
    appId: z
      .string()
      .min(1)
      .max(64)
      .describe("Workspace app id (matches the apps/<id>/ folder)"),
  }),
  run: async (input) => archiveWorkspaceApp({ appId: input.appId }),
});
