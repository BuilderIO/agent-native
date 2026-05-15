import { defineAction } from "@agent-native/core";
import {
  normalizeCodeAgentPermissionMode,
  updateCodeAgentRunRecord,
} from "@agent-native/core/code-agents";
import { z } from "zod";
import { toUiRun } from "./_code-agent-ui.js";

export default defineAction({
  description:
    "Update local Agent-Native Code run metadata such as execution mode.",
  schema: z.object({
    goalId: z.string().optional(),
    runId: z.string().min(1),
    permissionMode: z.string().optional(),
  }),
  run: async (args) => {
    const permissionMode = normalizeCodeAgentPermissionMode(
      args.permissionMode,
    );
    if (!permissionMode) {
      return {
        ok: false,
        message: "Unsupported mode",
        error: `Unsupported permission mode: ${args.permissionMode}`,
      };
    }
    const run = updateCodeAgentRunRecord(args.runId, {
      permissionMode,
      metadata: { permissionMode },
    });
    if (!run) {
      return {
        ok: false,
        message: "Run not found",
        error: `Agent-Native Code run not found: ${args.runId}`,
      };
    }
    return {
      ok: true,
      message: "Mode updated",
      run: toUiRun(run),
    };
  },
});
