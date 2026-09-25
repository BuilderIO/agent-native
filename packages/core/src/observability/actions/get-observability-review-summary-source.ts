import { z } from "zod";

import { fail, defineAction } from "../../action.js";
import { getOutputReviewSummarySource } from "../reviews.js";
import { requireObservabilityOrgAdmin } from "./authorization.js";

export default defineAction({
  description:
    "Read bounded, org-scoped chat and redacted tool-span evidence for one output. Use only artifact IDs present in this evidence; never infer or invent IDs. Tool evidence is explicitly marked unavailable when capture was disabled.",
  schema: z.object({
    runId: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe("The target observability run ID."),
  }),
  agentTool: true,
  readOnly: true,
  parallelSafe: true,
  run: async (args, ctx) => {
    const { orgId } = await requireObservabilityOrgAdmin(ctx);
    const result = await getOutputReviewSummarySource({
      runId: args.runId,
      orgId,
    });
    if (!result.found)
      fail("That agent output is no longer available.", { statusCode: 404 });
    return result;
  },
});
