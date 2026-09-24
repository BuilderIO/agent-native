import { z } from "zod";

import { fail, defineAction } from "../../action.js";
import { getOutputReviewAppForRun } from "../reviews.js";

export default defineAction({
  description:
    "Fetch the saved MCP App for one agent review run by run ID; returns null when no app was saved.",
  schema: z.object({
    runId: z.string().trim().min(1).max(200).describe("Agent review run ID."),
  }),
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  run: async (args, ctx) => {
    const userId = ctx?.userEmail;
    if (!userId)
      fail("Sign in to view saved review apps.", { statusCode: 401 });

    const result = await getOutputReviewAppForRun({
      runId: args.runId,
      userId,
    });
    if (!result.found)
      fail("That agent output is no longer available.", { statusCode: 404 });
    return result.app;
  },
});
