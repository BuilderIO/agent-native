import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { manageAiFilterBackfillInputSchema } from "@shared/ai-filter-backfill.js";

import {
  requestMailAiFilterBackfillUndo,
  startMailAiFilterBackfill,
} from "../server/lib/ai-filter-backfill.js";

export default defineAction({
  description:
    "Start applying Mail AI rules to recent inbox conversations or undo the exact label and archive changes from a run.",
  schema: manageAiFilterBackfillInputSchema,
  agentTool: false,
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Unauthenticated");

    switch (args.operation) {
      case "start":
        return startMailAiFilterBackfill(ownerEmail, args.ruleIds);
      case "undo":
        return requestMailAiFilterBackfillUndo(
          ownerEmail,
          args.runId,
          args.undoToken,
        );
    }
  },
});
