import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { getLabDefinition } from "../registry.js";
import { setUserLab } from "../store.js";

const schema = z.object({
  key: z.string().describe("The registered lab key to change."),
  enabled: z.boolean().describe("Whether the current user opts into it."),
});

export default defineAction({
  description:
    "Opt the current user into or out of one registered lab. Labs are user preferences, default off, and may expose new or unstable features.",
  schema,
  run: async (args, ctx) => {
    const email = ctx?.userEmail;
    if (!email) fail("Not authenticated.", { statusCode: 401 });
    if (!getLabDefinition(args.key)) {
      fail(`Unknown lab: ${args.key}`, { statusCode: 404 });
    }
    const values = await setUserLab(email, args.key, args.enabled);
    return { key: args.key, enabled: values[args.key] === true, values };
  },
});
