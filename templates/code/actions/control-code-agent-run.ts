import { defineAction } from "@agent-native/core";
import {
  getCodeAgentRunRecord,
  localCodeBackgroundAgentController,
  normalizeCodeAgentPermissionMode,
  updateCodeAgentRunRecord,
} from "@agent-native/core/code-agents";
import { z } from "zod";
import { backgroundRunToUiRun } from "./_code-agent-ui.js";

export default defineAction({
  description:
    "Resume, refresh, or mark a local Agent-Native Code run stopped.",
  schema: z.object({
    goalId: z.string().optional(),
    runId: z.string().min(1),
    command: z.enum(["approve", "resume", "status", "stop"]),
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

    if (
      args.command === "stop" ||
      args.command === "resume" ||
      args.command === "approve"
    ) {
      const result = await localCodeBackgroundAgentController.control({
        runId: args.runId,
        command: args.command,
      });
      const defaultMessage =
        args.command === "resume"
          ? "Session resumed"
          : args.command === "approve"
            ? "Approval executed"
            : "Run stopped";
      return {
        ok: result.ok,
        command: args.command,
        action: "refresh" as const,
        message: result.message ?? defaultMessage,
        error: result.error,
        run: result.run ? backgroundRunToUiRun(result.run) : undefined,
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
