import { z } from "zod";

import { fail, defineAction } from "../../action.js";
import { getOutputReviewDetailForRun } from "../reviews.js";
import {
  authorizeObservabilityOrgAdmin,
  getObservabilityOrgAdminAccess,
  resolveObservabilityReviewOrg,
} from "./authorization.js";

export default defineAction({
  description:
    "Load a real artifact preview and the full chat thread for one human-review row.",
  schema: z.object({
    runId: z.string().trim().min(1).max(200).describe("Agent review run ID."),
    orgId: z.string().trim().min(1).max(200).optional(),
  }),
  http: { method: "GET" },
  agentTool: false,
  readOnly: true,
  parallelSafe: true,
  authorize: authorizeObservabilityOrgAdmin,
  run: async (args, ctx) => {
    const access = getObservabilityOrgAdminAccess(ctx);
    const orgId = resolveObservabilityReviewOrg(access.reviewScope, args.orgId);

    const result = await getOutputReviewDetailForRun({
      runId: args.runId,
      orgId,
    });
    if (!result.found)
      fail("That agent output is no longer available.", { statusCode: 404 });
    return {
      runId: result.runId,
      orgId: result.orgId,
      app: result.app,
      messages: result.messages,
      artifacts: result.artifacts,
      summary: result.summary,
      ask: result.ask,
      answer: result.answer,
    };
  },
});
