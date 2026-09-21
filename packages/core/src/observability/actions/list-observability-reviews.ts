import { z } from "zod";

import { fail, defineAction } from "../../action.js";
import { listOutputReviews } from "../reviews.js";

export default defineAction({
  description:
    "List recent agent outputs as a human-review table with the original ask, answer, feedback, and pending instruction updates.",
  schema: z.object({
    sinceMs: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().max(100).optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  run: async (args, ctx) => {
    const userId = ctx?.userEmail;
    if (!userId) fail("Sign in to review agent outputs.", { statusCode: 401 });
    return listOutputReviews({
      sinceMs: args.sinceMs ?? Date.now() - 7 * 86_400_000,
      limit: args.limit ?? 100,
      userId,
    });
  },
});
