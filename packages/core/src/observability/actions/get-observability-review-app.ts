import { z } from "zod";

import { fail, defineAction } from "../../action.js";
import { getOutputReviewAppForRun } from "../reviews.js";
import {
  authorizeObservabilityOrgAdmin,
  getObservabilityOrgAdminAccess,
  resolveObservabilityReviewOrg,
} from "./authorization.js";

export default defineAction({
  description:
    "Fetch the saved MCP App for one agent review run by run ID; returns null when no app was saved.",
  schema: z.object({
    runId: z.string().trim().min(1).max(200).describe("Agent review run ID."),
    orgId: z.string().trim().min(1).max(200).optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  authorize: authorizeObservabilityOrgAdmin,
  run: async (args, ctx) => {
    const access = getObservabilityOrgAdminAccess(ctx);
    const orgId = resolveObservabilityReviewOrg(access.reviewScope, args.orgId);

    const result = await getOutputReviewAppForRun({
      runId: args.runId,
      orgId,
    });
    if (!result.found)
      fail("That agent output is no longer available.", { statusCode: 404 });
    return result.app;
  },
});
