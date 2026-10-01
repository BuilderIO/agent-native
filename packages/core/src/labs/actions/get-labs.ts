import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { getUserLabs } from "../store.js";

export default defineAction({
  description:
    "Return every registered lab and the current user's effective enabled state. Unset preferences inherit declared legacy flags or use the app-defined default.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async (_args, ctx) => {
    const email = ctx?.userEmail;
    if (!email) fail("Not authenticated.", { statusCode: 401 });
    return getUserLabs(email, { orgId: ctx?.orgId });
  },
});
