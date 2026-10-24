import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { getDecisionsStatus } from "../decide.js";

export default defineAction({
  description:
    "Check which configured decision providers are ready for this workspace. Returns provider order and ready, not_configured, or unknown status without revealing API keys.",
  schema: z.object({}),
  readOnly: true,
  run: async (_args, ctx) => {
    if (!ctx?.userEmail) fail("Not authenticated.", { statusCode: 401 });
    return getDecisionsStatus(ctx.userEmail);
  },
});
