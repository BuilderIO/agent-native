import { z } from "zod";

import { defineAction } from "../../action.js";
import { queueAutomationRunNow } from "../run-now.js";

export default defineAction({
  description:
    "Run one personal or organization automation immediately. This is an explicit send/run action and may perform the automation's real side effects.",
  agentTool: false,
  schema: z.object({
    name: z.string().min(1),
    scope: z.enum(["personal", "organization"]).default("personal"),
  }),
  run: async ({ name, scope }, ctx) => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    return queueAutomationRunNow({
      userEmail: ctx.userEmail,
      orgId: ctx.orgId,
      appId: ctx.appId,
      scope,
      name,
    });
  },
});
