import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import {
  clearMailAiFilterRules,
  restoreMailAiFilterRules,
} from "../server/lib/ai-filter-rule-undo.js";

export default defineAction({
  description:
    "Clear active Mail AI-filter rules or restore them from a short-lived undo token.",
  schema: z.discriminatedUnion("operation", [
    z.object({
      operation: z.literal("clear"),
      ids: z.array(z.string().min(1)).min(1).max(32),
    }),
    z.object({
      operation: z.literal("undo"),
      undoId: z.string().min(1),
    }),
  ]),
  agentTool: false,
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Unauthenticated");
    if (args.operation === "clear") {
      const undoId = await clearMailAiFilterRules(ownerEmail, args.ids);
      return { undoId };
    }
    await restoreMailAiFilterRules(ownerEmail, args.undoId);
    return { restored: true };
  },
});
