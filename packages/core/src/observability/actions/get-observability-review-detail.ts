import { z } from "zod";

import { fail, defineAction } from "../../action.js";
import { getOutputReviewDetailForRun } from "../reviews.js";

export default defineAction({
  description:
    "Load the saved preview and full chat transcript for one human-review run.",
  schema: z.object({
    runId: z.string().trim().min(1).max(200).describe("Agent review run ID."),
  }),
  http: { method: "GET" },
  agentTool: false,
  readOnly: true,
  parallelSafe: true,
  run: async (args, ctx) => {
    const userId = ctx?.userEmail;
    if (!userId) fail("Sign in to view review details.", { statusCode: 401 });

    const result = await getOutputReviewDetailForRun({
      runId: args.runId,
      userId,
    });
    if (!result.found)
      fail("That agent output is no longer available.", { statusCode: 404 });
    return { app: result.app, messages: result.messages };
  },
});
