import { z } from "zod";

import { defineAction } from "../../action.js";
import { isMcpAutomationOrigin } from "../../automations/mcp-origin.js";
import { automationOutcomeMessagesForUser } from "../../localization/automation-outcome-messages.js";
import { queueAutomationRunNow } from "../run-now.js";

export default defineAction({
  description:
    "Run an accessible automation by stable resourceId. A name or jobs/ path remains available for compatibility. This explicit action may perform the automation's real side effects.",
  agentTool: false,
  needsApproval: (_input, ctx) => isMcpAutomationOrigin(ctx?.caller),
  schema: z
    .object({
      resourceId: z.string().trim().min(1).optional(),
      name: z.string().trim().min(1).optional(),
      path: z.string().trim().min(1).optional(),
      scope: z.enum(["personal", "organization"]).default("personal"),
    })
    .refine(
      ({ resourceId, name, path }) =>
        Number(Boolean(resourceId)) +
          Number(Boolean(name)) +
          Number(Boolean(path)) ===
        1,
      { message: "Specify exactly one of resourceId, name, or path." },
    ),
  run: async ({ resourceId, name, path, scope }, ctx) => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    if (ctx.caller === "automation" || ctx.automation) {
      const messages = await automationOutcomeMessagesForUser(ctx.userEmail);
      throw new Error(messages.chainingUnsupported);
    }
    return queueAutomationRunNow({
      userEmail: ctx.userEmail,
      orgId: ctx.orgId,
      appId: ctx.appId,
      resourceId,
      scope,
      ...(path ? { path } : name ? { name } : {}),
      requestHeaders: ctx.requestHeaders,
    });
  },
});
