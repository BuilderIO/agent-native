import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { getUserLabStates } from "../store.js";

export default defineAction({
  description:
    "Return each registered lab's effective state, including whether it comes from a saved choice or inherited feature flags.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async (_args, ctx) => {
    const email = ctx?.userEmail;
    if (!email) fail("Not authenticated.", { statusCode: 401 });
    return getUserLabStates(email, { orgId: ctx?.orgId });
  },
});
