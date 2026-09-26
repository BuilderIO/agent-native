import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { manageAiFilterBackfillInputSchema } from "@shared/ai-filter-backfill.js";

import {
  listRecentMailAiFilterBackfills,
  readMailAiFilterBackfill,
  requestMailAiFilterBackfillUndo,
  startMailAiFilterBackfill,
} from "../server/lib/ai-filter-backfill.js";

export default defineAction({
  description:
    "Start applying Mail AI rules to recent inbox conversations, check backfill progress, or undo the exact label and archive changes from a run.",
  schema: manageAiFilterBackfillInputSchema,
  agentTool: false,
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Unauthenticated");

    switch (args.operation) {
      case "start":
        return startMailAiFilterBackfill(ownerEmail, args.ruleIds);
      case "status":
        return readMailAiFilterBackfill(ownerEmail, args.runId);
      case "recent":
        return listRecentMailAiFilterBackfills(ownerEmail);
      case "undo":
        return requestMailAiFilterBackfillUndo(
          ownerEmail,
          args.runId,
          args.undoToken,
        );
    }
  },
});
