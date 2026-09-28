import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { getUserLabs } from "../store.js";

export default defineAction({
  description:
    "Return every registered lab and the current user's enabled state. Unset preferences use each lab's app-defined default.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async (_args, ctx) => {
    const email = ctx?.userEmail;
    if (!email) fail("Not authenticated.", { statusCode: 401 });
    return getUserLabs(email);
  },
});
