import { z } from "zod";

import { defineAction } from "../../action.js";
import { listFeatureFlags } from "../registry.js";
import { evaluateFeatureFlag } from "../store.js";

export default defineAction({
  description:
    "Return the boolean values of every feature flag registered by this app for the current caller. Unknown or unconfigured flags always evaluate to false.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async (_args, ctx) => {
    const scope = { userEmail: ctx?.userEmail, orgId: ctx?.orgId };
    const values = Object.fromEntries(
      await Promise.all(
        listFeatureFlags().map(async ({ key }) => [
          key,
          await evaluateFeatureFlag(key, scope).catch(() => false),
        ]),
      ),
    );
    return values;
  },
});
