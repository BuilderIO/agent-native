import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { getUserLabs } from "../store.js";

export default defineAction({
  description:
    "Return every user lab registered by this app and whether the current user has opted in. Labs default to false.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async (_args, ctx) => {
    const email = ctx?.userEmail;
    if (!email) fail("Not authenticated.", { statusCode: 401 });
    return getUserLabs(email);
  },
});
