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

export default defineAction({
  description:
    "Create and start a local Agent-Native Code run. The run store is shared with the CLI and Desktop.",
  schema: z.object({
    goalId: z.string().optional().default("task"),
    prompt: z.string().min(1),
    permissionMode: z.string().optional(),
  }),
  run: async (args) => {
    const permissionMode =
      normalizeCodeAgentPermissionMode(args.permissionMode) ?? "full-auto";
    const prompt = args.prompt.trim();
    const goalId = args.goalId || "task";
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
        { label: "Agent", value: "Running locally" },
        {
          label: "Mode",
          value: permissionMode === "read-only" ? "Plan mode" : "Auto mode",
        },
      ],
      cwd: process.cwd(),
      metadata: {
        prompt,
        source: "code-template",
        permissionMode,
      },
    });
    const event = appendCodeAgentTranscriptEvent({
      runId: run.id,
      kind: "user",
      message: prompt,
      metadata: { source: "initial-prompt" },
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
    });
    return {
      ok: true,
      message: "Session started",
      run: toUiRun(run),
      event: toUiTranscriptEvent(event),
    };
  },
});
