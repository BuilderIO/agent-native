import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { grantWorkspaceResourcesToApp } from "../server/lib/workspace-resources-store.js";

export default defineAction({
  description:
    "Grant several selected workspace resources, knowledge packs, or MCP servers to an app, skipping existing active grants.",
  schema: z.object({
    appId: z.string().describe("App ID receiving the resources"),
    resourceIds: z
      .array(z.string())
      .max(100)
      .describe("Workspace resource IDs to grant"),
  }),
  run: async (args) => grantWorkspaceResourcesToApp(args),
});
