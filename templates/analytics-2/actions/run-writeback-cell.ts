import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { requireCurrentWorkspaceCapability } from "../server/lib/analytics-capabilities.js";
import { ANALYTICS_CONTROL_IDS as controls } from "../shared/analytics-control-ids.js";

export default defineAction({
  description: "Check availability of warehouse Writeback for a notebook cell.",
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  schema: z.object({
    projectId: z.string().trim().min(1),
    cellId: z.string().trim().min(1),
    targetTable: z.string().trim().min(1).max(300),
  }),
  outputSchema: z.never(),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  },
  run: async () => {
    await requireCurrentWorkspaceCapability(controls.writeback);
    return fail("Workspace permissions are unavailable.", {
      statusCode: 404,
      errorCode: "missing_backing",
    });
  },
});
