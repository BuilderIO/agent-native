import { defineAction } from "@agent-native/core";
import { normalizeCodeAgentPermissionMode } from "@agent-native/core/code-agents";
import { z } from "zod";
import { appendFollowUpAndRun } from "./_code-agent-ui.js";

export default defineAction({
  description:
    "Append a follow-up prompt to an existing local Agent-Native Code run and resume execution.",
  schema: z.object({
    goalId: z.string().optional(),
    runId: z.string().min(1),
    prompt: z.string().min(1),
    permissionMode: z.string().optional(),
  }),
  run: async (args) => {
    const permissionMode = normalizeCodeAgentPermissionMode(
      args.permissionMode,
    );
    const event = appendFollowUpAndRun({
      runId: args.runId,
      prompt: args.prompt.trim(),
      permissionMode: permissionMode ?? undefined,
    });
    return {
      ok: true,
      message: "Follow-up queued",
      event,
    };
  },
});
