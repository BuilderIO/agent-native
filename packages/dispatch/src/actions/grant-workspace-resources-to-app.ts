import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { authorizeDispatchAdmin } from "../server/lib/app-roles.js";
import { grantWorkspaceResourcesToApp } from "../server/lib/workspace-resources-store.js";

export default defineAction({
  description:
    "Grant several selected workspace resources, knowledge packs, or MCP servers to an app, skipping existing active grants.",
  authorize: authorizeDispatchAdmin,
  schema: z.object({
    appId: z.string().describe("App ID receiving the resources"),
    resourceIds: z
      .array(z.string())
      .max(100)
      .describe("Workspace resource IDs to grant"),
  }),
  run: async (args) => grantWorkspaceResourcesToApp(args),
});
