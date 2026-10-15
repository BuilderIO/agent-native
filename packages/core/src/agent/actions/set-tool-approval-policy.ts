import { z } from "zod";

import { defineAction } from "../../action.js";
import { setAgentToolApprovalPolicy } from "../tool-approval-store.js";

export default defineAction({
  description:
    "Enable or disable future approval prompts for one action type for the signed-in user.",
  schema: z.object({
    toolName: z.string().trim().min(1).max(128),
    enabled: z.boolean().default(true),
    approvalId: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe(
        "The approval the user clicked, so the grant covers that tool revision.",
      ),
  }),
  http: { method: "POST" },
  agentTool: false,
  run: async (args, context) => {
    const ownerEmail = context?.userEmail?.trim().toLowerCase();
    if (!ownerEmail) throw new Error("Sign in to manage approval preferences.");

    await setAgentToolApprovalPolicy({
      binding: {
        ownerEmail,
        orgId: context?.orgId?.trim() || null,
        toolName: args.toolName,
      },
      enabled: args.enabled,
      ...(args.approvalId ? { approvalId: args.approvalId } : {}),
    });
    return { toolName: args.toolName, enabled: args.enabled };
  },
});
