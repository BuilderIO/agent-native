import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { syncResourcesToApp } from "../server/lib/workspace-resources-store.js";

export default defineAction({
  description:
    "Push all applicable workspace resources (skills, instructions, agents) to an app. Pushes scope=all resources plus any with active grants for this app.",
  schema: z.object({
    appId: z.string().describe("App ID to sync resources to"),
  }),
  run: async (args) => syncResourcesToApp(args.appId),
});
