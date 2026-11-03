import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { saveDiagnosticContext } from "../server/lib/diagnostic-context.js";
import { diagnosticContextInputSchema } from "../shared/diagnostic-context.js";
export default defineAction({
  audit: {
    recordInputs: false,
    target: (args) => ({
      type: "recording-diagnostic-capture",
      id: args.captureId,
      visibility: "private",
    }),
    summary: (args) =>
      `Private diagnostic capture saved: ${args.captured}; ${args.coverage.length} coverage spans; ${args.droppedEvents} dropped events.`,
  },
  description:
    "Save explicitly approved private context independently of video sharing. The authenticated capturing user owns it; retries with the same capture, version and payload are idempotent. UI/internal use only.",
  agentTool: false,
  maxBodyBytes: 2_500_000,
  schema: diagnosticContextInputSchema,
  outputSchema: z.object({
    contextId: z.string(),
    contextVersion: z.number(),
    status: z.literal("saved"),
    expiresAt: z.string(),
  }),
  run: saveDiagnosticContext,
});
