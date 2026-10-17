import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { listOutputReviews } from "../reviews.js";
import {
  authorizeObservabilityOrgAdmin,
  getObservabilityOrgAdminAccess,
} from "./authorization.js";

export default defineAction({
  description:
    "List recent agent outputs as a human-review table with the original ask, answer, feedback, and pending instruction updates.",
  schema: z.object({
    sinceMs: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().max(100).optional(),
    cacheOrgId: z.string().trim().min(1).max(200).optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  authorize: authorizeObservabilityOrgAdmin,
  run: async (args, ctx) => {
    const { orgId, reviewScope } = getObservabilityOrgAdminAccess(ctx);
    if (args.cacheOrgId !== undefined && args.cacheOrgId !== orgId) {
      fail("The active organization changed. Reload human review.", {
        statusCode: 403,
      });
    }
    return listOutputReviews({
      sinceMs: args.sinceMs ?? Date.now() - 7 * 86_400_000,
      limit: args.limit ?? 100,
      scope: reviewScope,
    });
  },
});
