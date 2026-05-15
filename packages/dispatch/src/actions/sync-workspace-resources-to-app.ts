import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { syncResourcesToApp } from "../server/lib/workspace-resources-store.js";

export default defineAction({
  description:
    "Legacy bridge for selected-only workspace resources that need a copied app resource. Scope=all workspace resources are inherited at runtime and are not synced.",
  schema: z.object({
    appId: z.string().describe("App ID to sync resources to"),
  }),
  run: async (args) => syncResourcesToApp(args.appId),
});
