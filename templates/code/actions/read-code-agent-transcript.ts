import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listUiTranscript } from "./_code-agent-ui.js";

export default defineAction({
  description: "Read transcript events for a local Agent-Native Code run.",
  schema: z.object({
    goalId: z.string().optional(),
    runId: z.string().min(1),
  }),
  http: { method: "GET" },
  run: async (args) => ({
    status: "ok" as const,
    runId: args.runId,
    events: listUiTranscript(args.runId),
  }),
});
