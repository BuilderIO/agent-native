import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listWorkspaceResourcesForApp } from "../server/lib/workspace-resources-store.js";

export default defineAction({
  description:
    "List the global and explicitly granted workspace resources an app receives, including auto-loaded instructions and grant sync status.",
  schema: z.object({
    appId: z.string().describe("Workspace app ID"),
  }),
  http: { method: "GET" },
  run: async (args) => listWorkspaceResourcesForApp(args.appId),
});
