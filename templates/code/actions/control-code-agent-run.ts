import { defineAction } from "@agent-native/core";
import {
  getCodeAgentRunRecord,
  normalizeCodeAgentPermissionMode,
  updateCodeAgentRunRecord,
} from "@agent-native/core/code-agents";
import { z } from "zod";
import { resumeCodeAgentInBackground, toUiRun } from "./_code-agent-ui.js";

export default defineAction({
  description:
    "Resume, refresh, or mark a local Agent-Native Code run stopped.",
  schema: z.object({
    goalId: z.string().optional(),
    runId: z.string().min(1),
    command: z.enum(["resume", "status", "stop"]),
    permissionMode: z.string().optional(),
  }),
  run: async (args) => {
    const existing = getCodeAgentRunRecord(args.runId);
    if (!existing) {
      return {
        ok: false,
        command: args.command,
        action: "none" as const,
        message: "Run not found",
        error: `Agent-Native Code run not found: ${args.runId}`,
      };
    }

    const permissionMode = normalizeCodeAgentPermissionMode(
      args.permissionMode,
    );
    if (permissionMode) {
      updateCodeAgentRunRecord(args.runId, {
        permissionMode,
        metadata: { permissionMode },
      });
    }

    if (args.command === "stop") {
      const run = updateCodeAgentRunRecord(args.runId, {
        status: "paused",
        phase: "stopped",
        needsApproval: false,
        progress: {
          label: "Stopped",
          completed: 0,
          total: 1,
          percent: 0,
        },
      });
      return {
        ok: true,
        command: args.command,
        action: "refresh" as const,
        message:
          "Run marked stopped. If another terminal owns the process, stop it there too.",
        run: run ? toUiRun(run) : undefined,
      };
    }

    if (args.command === "resume") {
      resumeCodeAgentInBackground(args.runId);
      return {
        ok: true,
        command: args.command,
        action: "refresh" as const,
        message: "Session resumed",
      };
    }

    return {
      ok: true,
      command: args.command,
      action: "refresh" as const,
      message: "Status refreshed",
    };
  },
});
