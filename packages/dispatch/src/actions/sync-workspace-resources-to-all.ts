import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { syncResourcesToAllApps } from "../server/lib/workspace-resources-store.js";

export default defineAction({
  description:
    "Push workspace resources to all discovered apps. Scope=all resources go everywhere; scope=selected only go to apps with grants.",
  schema: z.object({}),
  run: async () => syncResourcesToAllApps(),
});
