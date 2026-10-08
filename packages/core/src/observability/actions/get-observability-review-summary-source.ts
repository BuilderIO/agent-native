import { z } from "zod";

import { fail, defineAction } from "../../action.js";
import { getOutputReviewSummarySource } from "../reviews.js";
import {
  authorizeObservabilityOrgAdmin,
  getObservabilityOrgAdminAccess,
  requireObservabilityReviewRunScope,
  resolveObservabilityReviewOrg,
} from "./authorization.js";

export default defineAction({
  description:
    "Read a bounded, org-scoped full chat thread, attached artifact refs, and redacted successful tool-result evidence for one review row. Use only artifact IDs present in this evidence; never infer or invent IDs. Tool evidence is explicitly marked unavailable when absent, and malformedThreadToolOutput warns that persisted thread output could not be parsed.",
  schema: z.object({
    runId: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe("The target observability run ID."),
    orgId: z.string().trim().min(1).max(200).optional(),
  }),
  agentTool: true,
  readOnly: true,
  parallelSafe: true,
  authorize: authorizeObservabilityOrgAdmin,
  run: async (args, ctx) => {
    const access = getObservabilityOrgAdminAccess(ctx);
    requireObservabilityReviewRunScope(args.runId);
    const orgId = resolveObservabilityReviewOrg(access.reviewScope, args.orgId);
    const result = await getOutputReviewSummarySource({
      runId: args.runId,
      orgId,
    });
    if (!result.found)
      fail("That agent output is no longer available.", { statusCode: 404 });
    return result;
  },
});
