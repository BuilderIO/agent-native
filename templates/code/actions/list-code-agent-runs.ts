import { defineAction } from "@agent-native/core";
import { listCodeAgentRunRecords } from "@agent-native/core/code-agents";
import { z } from "zod";
import { toUiRun } from "./_code-agent-ui.js";

export default defineAction({
  description:
    "List local Agent-Native Code sessions for the customizable Code UI.",
  schema: z.object({
    goalId: z.string().optional(),
  }),
  http: { method: "GET" },
  run: async (args) => ({
    status: "ok" as const,
    goalId: args.goalId,
    runs: listCodeAgentRunRecords(args.goalId).map(toUiRun),
  }),
});
