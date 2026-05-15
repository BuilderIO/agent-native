import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { syncResourcesToAllApps } from "../server/lib/workspace-resources-store.js";

export default defineAction({
  description:
    "Legacy bridge selected-only workspace resources to discovered apps with active grants. Scope=all workspace resources are inherited at runtime and are not synced.",
  schema: z.object({}),
  run: async () => syncResourcesToAllApps(),
});
