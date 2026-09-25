import { z } from "zod";

import { fail, defineAction } from "../../action.js";
import { getOutputReviewDetailForRun } from "../reviews.js";
import { requireObservabilityOrgAdmin } from "./authorization.js";

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
    const { orgId } = await requireObservabilityOrgAdmin(ctx);

    const result = await getOutputReviewDetailForRun({
      runId: args.runId,
      orgId,
    });
    if (!result.found)
      fail("That agent output is no longer available.", { statusCode: 404 });
    return { app: result.app, messages: result.messages };
  },
});
