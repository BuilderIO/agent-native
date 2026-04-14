import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { createResourceGrant } from "../server/lib/workspace-resources-store.js";

export default defineAction({
  description:
    "Grant an app access to a workspace resource (skill, instruction, or agent). Admin only.",
  schema: z.object({
    resourceId: z.string().describe("Workspace resource ID"),
    appId: z
      .string()
      .describe("App ID to grant access to, e.g. mail, analytics"),
  }),
  run: async (args) => createResourceGrant(args.resourceId, args.appId),
});
