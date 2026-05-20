import { defineAction } from "@agent-native/core";
import {
  appendCodeAgentTranscriptEvent,
  createCodeAgentRunRecord,
  normalizeCodeAgentPermissionMode,
} from "@agent-native/core/code-agents";
import { z } from "zod";
import {
  runCodeAgentInBackground,
  titleFromPrompt,
  toUiRun,
  toUiTranscriptEvent,
  truncateForDisplay,
} from "./_code-agent-ui.js";
import type { CodeAgentReasoningEffort } from "@agent-native/code-agents-ui/types";

const promptAttachmentSchema = z.object({
  name: z.string().min(1),
  type: z.string().optional(),
  size: z.number().optional(),
  text: z.string().optional(),
  dataUrl: z.string().optional(),
});

export default defineAction({
  description:
    "Create and start a local Agent-Native Code run. The run store is shared with the CLI and Desktop.",
  schema: z.object({
    goalId: z.string().optional().default("task"),
    prompt: z.string().min(1),
    permissionMode: z.string().optional(),
    engine: z.string().optional(),
    model: z.string().optional(),
    effort: z.string().optional(),
    cwd: z.string().optional(),
    attachments: z.array(promptAttachmentSchema).optional(),
  }),
  run: async (args) => {
    const permissionMode =
      normalizeCodeAgentPermissionMode(args.permissionMode) ?? "full-auto";
    const prompt = args.prompt.trim();
    const goalId = args.goalId || "task";
    const cwd = args.cwd || process.cwd();
    const attachments =
      args.attachments && args.attachments.length > 0
        ? args.attachments
        : undefined;
    const effort =
      args.effort === "auto"
        ? undefined
        : (args.effort as CodeAgentReasoningEffort | undefined);
    const run = createCodeAgentRunRecord({
      goalId,
      title: titleFromPrompt(prompt),
      subtitle:
        goalId === "task" ? "Generic coding task" : `Slash command /${goalId}`,
      status: "running",
      phase: "starting",
      permissionMode,
      progress: {
        label: "Starting",
        completed: 0,
        total: 1,
        percent: 5,
      },
      details: [
        { label: "Prompt", value: truncateForDisplay(prompt, 160) },
        { label: "Folder", value: cwd },
        { label: "Agent", value: "Running locally" },
        {
          label: "Mode",
          value: permissionMode === "read-only" ? "Plan mode" : "Auto mode",
        },
        ...(args.model
          ? [
              {
                label: "Model",
                value: `${args.model}${args.effort ? ` / ${args.effort}` : ""}`,
              },
            ]
          : []),
      ],
      cwd,
      metadata: {
        prompt,
        source: "code-template",
        permissionMode,
        engine: args.engine,
        model: args.model,
        effort: args.effort,
        attachments,
        cwd,
      },
    });
    const event = appendCodeAgentTranscriptEvent({
      runId: run.id,
      kind: "user",
      message: prompt,
      metadata: { source: "initial-prompt", attachments },
    });
    appendCodeAgentTranscriptEvent({
      runId: run.id,
      kind: "status",
      message: "Starting local Agent-Native Code execution.",
      metadata: {
        status: "running",
        phase: "starting",
      },
    });
    runCodeAgentInBackground({
      runId: run.id,
      prompt,
      appendUserEvent: false,
      model: args.model,
      reasoningEffort: effort,
      attachments,
    });
    return {
      ok: true,
      message: "Session started",
      run: toUiRun(run),
      event: toUiTranscriptEvent(event),
    };
  },
});
