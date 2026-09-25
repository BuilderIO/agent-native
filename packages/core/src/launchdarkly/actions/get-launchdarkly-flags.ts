import { z } from "zod";

import { defineAction } from "../../action.js";
import { isLaunchDarklyFlagEnabled } from "../evaluate.js";

/** Keeps one call from fanning out into an unbounded number of evaluations. */
const MAX_KEYS = 50;

export default defineAction({
  description:
    "Evaluate one or more LaunchDarkly feature flags for the current caller. Returns each key's variation, or the request's defaultValue (false unless specified) when LaunchDarkly is not configured or the key does not exist.",
  schema: z.object({
    keys: z.array(z.string().min(1)).min(1).max(MAX_KEYS),
    defaultValue: z.boolean().optional(),
  }),
  http: { method: "GET" },
  run: async ({ keys, defaultValue = false }, ctx) => {
    const actor = { userEmail: ctx?.userEmail, orgId: ctx?.orgId };
    const uniqueKeys = [...new Set(keys)];
    const entries = await Promise.all(
      uniqueKeys.map(
        async (key) =>
          [
            key,
            await isLaunchDarklyFlagEnabled(key, actor, defaultValue),
          ] as const,
      ),
    );
    return { flags: Object.fromEntries(entries) };
  },
});
