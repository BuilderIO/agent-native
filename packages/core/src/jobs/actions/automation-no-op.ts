import { z } from "zod";

import { defineAction } from "../../action.js";
import type { AgentChatEvent } from "../../agent/types.js";
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

const automationNoOpResultSchema = automationNoOpSchema.extend({
  status: z.literal("skipped"),
});

export function automationNoOpReasonFromEvents(
  events: readonly AgentChatEvent[],
): string | undefined {
  const declaration = [...events]
    .reverse()
    .find(
      (event) =>
        event.type === "tool_done" &&
        event.tool === AUTOMATION_NO_OP_TOOL &&
        !event.isError,
    );
  if (declaration?.type !== "tool_done") return undefined;
  return automationNoOpResultSchema.parse(JSON.parse(declaration.result))
    .reason;
}

export default defineAction({
  description: AUTOMATION_OUTCOME_MESSAGES["en-US"].noOpInstruction,
  schema: automationNoOpSchema,
  http: false,
  agentTool: false,
  readOnly: true,
  run: async ({ reason }) => ({ status: "skipped" as const, reason }),
});
