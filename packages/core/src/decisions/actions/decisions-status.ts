import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { getDecisionsStatus } from "../decide.js";

export default defineAction({
  description:
    "Check decision provider readiness and question capabilities for this workspace. Returns provider order, capability verification/enabled states, and credential readiness without revealing API keys.",
  schema: z.object({}),
  readOnly: true,
  run: async (_args, ctx) => {
    if (!ctx?.userEmail) fail("Not authenticated.", { statusCode: 401 });
    return getDecisionsStatus(ctx.userEmail, {
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });
  },
});
