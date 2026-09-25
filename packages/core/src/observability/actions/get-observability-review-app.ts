import { z } from "zod";

import { fail, defineAction } from "../../action.js";
import { getOutputReviewAppForRun } from "../reviews.js";
import { requireObservabilityOrgAdmin } from "./authorization.js";

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
    const { orgId } = await requireObservabilityOrgAdmin(ctx);

    const result = await getOutputReviewAppForRun({
      runId: args.runId,
      orgId,
    });
    if (!result.found)
      fail("That agent output is no longer available.", { statusCode: 404 });
    return result.app;
  },
});
