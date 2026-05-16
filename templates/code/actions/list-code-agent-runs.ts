import { defineAction } from "@agent-native/core";
import { localCodeBackgroundAgentController } from "@agent-native/core/code-agents";
import { z } from "zod";
import { backgroundRunToUiRun } from "./_code-agent-ui.js";

export default defineAction({
  description:
    "List local Agent-Native Code sessions for the customizable Code UI.",
  schema: z.object({
    goalId: z.string().optional(),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const runs = await Promise.resolve(
      localCodeBackgroundAgentController.list({ goalId: args.goalId }),
    );
    return {
      status: "ok" as const,
      goalId: args.goalId,
      runs: runs.map(backgroundRunToUiRun),
    };
  },
});
