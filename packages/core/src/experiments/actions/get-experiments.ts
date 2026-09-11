import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { getUserExperiments } from "../store.js";

export default defineAction({
  description:
    "Return every user experiment registered by this app and whether the current user has opted in. Experiments default to false.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async (_args, ctx) => {
    const email = ctx?.userEmail;
    if (!email) fail("Not authenticated.", { statusCode: 401 });
    return getUserExperiments(email);
  },
});
