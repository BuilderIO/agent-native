import { z } from "zod";

import { defineAction } from "../../action.js";
import { AUTOMATION_OUTCOME_MESSAGES } from "../../localization/automation-outcome-messages.js";

export const AUTOMATION_NO_OP_TOOL = "automation-no-op";
export const automationNoOpSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .describe(AUTOMATION_OUTCOME_MESSAGES["en-US"].noOpReason),
});

export default defineAction({
  description: AUTOMATION_OUTCOME_MESSAGES["en-US"].noOpInstruction,
  schema: automationNoOpSchema,
  http: false,
  agentTool: false,
  readOnly: true,
  run: async ({ reason }) => ({ status: "skipped" as const, reason }),
});
