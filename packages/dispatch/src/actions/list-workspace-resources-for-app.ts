import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { listWorkspaceResourcesForApp } from "../server/lib/workspace-resources-store.js";

export default defineAction({
  description:
    "List the inherited workspace and explicitly granted resources an app receives, including auto-loaded instructions.",
  schema: z.object({
    appId: z.string().describe("Workspace app ID"),
  }),
  http: { method: "GET" },
  run: async (args) => listWorkspaceResourcesForApp(args.appId),
});
