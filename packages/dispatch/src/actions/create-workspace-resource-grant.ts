import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { authorizeDispatchAdmin } from "../server/lib/app-roles.js";
import { createResourceGrant } from "../server/lib/workspace-resources-store.js";

export default defineAction({
  description:
    "Grant an app access to a workspace resource (skill, instruction, agent, knowledge pack, or MCP server). Admin only.",
  authorize: authorizeDispatchAdmin,
  schema: z.object({
    resourceId: z.string().describe("Workspace resource ID"),
    appId: z
      .string()
      .describe("App ID to grant access to, e.g. mail, analytics"),
  }),
  run: async (args) => createResourceGrant(args.resourceId, args.appId),
});
