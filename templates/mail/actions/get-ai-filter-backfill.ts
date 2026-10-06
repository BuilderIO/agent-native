import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getAiFilterBackfillInputSchema } from "@shared/ai-filter-backfill.js";

import {
  listRecentMailAiFilterBackfills,
  readMailAiFilterBackfill,
} from "../server/lib/ai-filter-backfill.js";

export default defineAction({
  description:
    "Check the progress of a Mail AI-filter backfill or list recent backfills.",
  schema: getAiFilterBackfillInputSchema,
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Unauthenticated");

    if (args.operation === "status")
      return readMailAiFilterBackfill(ownerEmail, args.runId);
    return listRecentMailAiFilterBackfills(ownerEmail);
  },
});
