import { z } from "zod";

import { defineAction } from "../../action.js";
import {
  JOURNALED_TOOL_REPLAY_PREFIX,
  RECOVERED_TOOL_REPLAY_PREFIX,
} from "../../agent/engine/tool-call-journal-seed.js";
import type { AgentChatEvent } from "../../agent/types.js";
import { AUTOMATION_OUTCOME_MESSAGES } from "../../localization/automation-outcome-messages.js";
import { automationRecoveryMessagesForLocale } from "../../localization/automation-recovery-messages.js";

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

export class AutomationNoOpEvidenceUnreadableError extends Error {
  readonly errorCode = "automation_no_op_evidence_unreadable";

  constructor(cause: unknown) {
    super(automationRecoveryMessagesForLocale().unreadable, { cause });
    this.name = "AutomationNoOpEvidenceUnreadableError";
  }
}

export function automationNoOpReasonFromEvents(
  events: readonly AgentChatEvent[],
): string | undefined {
  const declarations = [...events]
    .reverse()
    .filter(
      (event): event is Extract<AgentChatEvent, { type: "tool_done" }> =>
        event.type === "tool_done" &&
        event.tool === AUTOMATION_NO_OP_TOOL &&
        !event.isError,
    );
  const declaration =
    declarations.find((event) => !event.replayed) ?? declarations[0];
  if (!declaration) return undefined;
  const prefix = declaration.replayed
    ? [JOURNALED_TOOL_REPLAY_PREFIX, RECOVERED_TOOL_REPLAY_PREFIX].find(
        (prefix) => declaration.result.startsWith(prefix),
      )
    : undefined;
  const result = prefix
    ? declaration.result.slice(prefix.length)
    : declaration.result;
  try {
    return automationNoOpResultSchema.parse(JSON.parse(result)).reason;
  } catch (error) {
    throw new AutomationNoOpEvidenceUnreadableError(error);
  }
}

export default defineAction({
  description: AUTOMATION_OUTCOME_MESSAGES["en-US"].noOpInstruction,
  schema: automationNoOpSchema,
  http: false,
  agentTool: false,
  readOnly: true,
  run: async ({ reason }) => ({ status: "skipped" as const, reason }),
});
