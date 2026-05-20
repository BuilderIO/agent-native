import { defineAction } from "@agent-native/core";
import { normalizeCodeAgentPermissionMode } from "@agent-native/core/code-agents";
import type { CodeAgentReasoningEffort } from "@agent-native/code-agents-ui/types";
import { z } from "zod";
import { appendFollowUpAndRun } from "./_code-agent-ui.js";

const promptAttachmentSchema = z.object({
  name: z.string().min(1),
  type: z.string().optional(),
  size: z.number().optional(),
  text: z.string().optional(),
  dataUrl: z.string().optional(),
});

export default defineAction({
  description:
    "Append a follow-up prompt to an existing local Agent-Native Code run and resume execution.",
  schema: z.object({
    goalId: z.string().optional(),
    runId: z.string().min(1),
    prompt: z.string().min(1),
    permissionMode: z.string().optional(),
    engine: z.string().optional(),
    model: z.string().optional(),
    effort: z.string().optional(),
    followUpMode: z.enum(["immediate", "queued"]).optional(),
    attachments: z.array(promptAttachmentSchema).optional(),
  }),
  run: async (args) => {
    const permissionMode = normalizeCodeAgentPermissionMode(
      args.permissionMode,
    );
    const effort =
      args.effort === "auto"
        ? undefined
        : (args.effort as CodeAgentReasoningEffort | undefined);
    const event = await appendFollowUpAndRun({
      runId: args.runId,
      prompt: args.prompt.trim(),
      permissionMode: permissionMode ?? undefined,
      engine: args.engine,
      model: args.model,
      effort,
      followUpMode: args.followUpMode,
      attachments: args.attachments,
    });
    return {
      ok: true,
      message: "Follow-up queued",
      event,
    };
  },
});
