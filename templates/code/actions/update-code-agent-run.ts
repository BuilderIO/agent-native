import { defineAction } from "@agent-native/core";
import {
  normalizeCodeAgentPermissionMode,
  updateCodeAgentRunRecord,
} from "@agent-native/core/code-agents";
import { z } from "zod";
import { toUiRun } from "./_code-agent-ui.js";

export default defineAction({
  description:
    "Update local Agent-Native Code run metadata such as execution mode or sidebar pin state.",
  schema: z.object({
    goalId: z.string().optional(),
    runId: z.string().min(1),
    title: z.string().optional(),
    permissionMode: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  run: async (args) => {
    const permissionMode = args.permissionMode
      ? normalizeCodeAgentPermissionMode(args.permissionMode)
      : undefined;
    if (args.permissionMode && !permissionMode) {
      return {
        ok: false,
        message: "Unsupported mode",
        error: `Unsupported permission mode: ${args.permissionMode}`,
      };
    }
    const metadata = args.metadata ?? {};
    const title = args.title?.trim();
    if (!permissionMode && !title && Object.keys(metadata).length === 0) {
      return {
        ok: false,
        message: "Nothing to update",
        error: "Provide title, permissionMode, or metadata.",
      };
    }
    const run = updateCodeAgentRunRecord(args.runId, {
      ...(title ? { title } : {}),
      ...(permissionMode ? { permissionMode } : {}),
      metadata: {
        ...metadata,
        ...(permissionMode ? { permissionMode } : {}),
      },
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
