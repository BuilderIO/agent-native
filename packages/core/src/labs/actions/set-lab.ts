import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { getLabDefinition } from "../registry.js";
import { setUserLabStates } from "../store.js";

const schema = z.object({
  key: z.string().describe("The registered lab key to change."),
  enabled: z.boolean().describe("Whether the current user opts into it."),
});

export default defineAction({
  description:
    "Opt the current user into or out of one registered lab. Unset preferences inherit declared legacy flags or use the app-defined default; labs may expose new or unstable features.",
  schema,
  http: { method: "POST" },
  run: async (args, ctx) => {
    const email = ctx?.userEmail;
    if (!email) fail("Not authenticated.", { statusCode: 401 });
    if (!getLabDefinition(args.key)) {
      fail(`Unknown lab: ${args.key}`, { statusCode: 404 });
    }
    const states = await setUserLabStates(email, args.key, args.enabled, {
      orgId: ctx?.orgId,
    });
    const state = states[args.key];
    if (!state || "error" in state) {
      // guard:allow-bare-error — invariant: a successful setter must return its valid target state
      throw new Error(
        `Could not read saved lab state after updating ${args.key}`,
      );
    }
    const values = Object.fromEntries(
      Object.entries(states).flatMap(([key, value]) =>
        "error" in value ? [] : [[key, value.enabled]],
      ),
    );
    return { key: args.key, enabled: state.enabled, values, states };
  },
});
