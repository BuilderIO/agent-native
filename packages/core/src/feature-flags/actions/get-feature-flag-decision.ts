import { z } from "zod";

import { defineAction } from "../../action.js";
import { evaluateFeatureFlagDecision } from "../store.js";

export default defineAction({
  description: "Return a feature flag decision for explicit exposure tracking.",
  schema: z.object({ key: z.string() }),
  http: { method: "GET" },
  agentTool: false,
  toolCallable: false,
  run: async ({ key }, ctx) =>
    evaluateFeatureFlagDecision(key, {
      userEmail: ctx?.userEmail,
      userKey: ctx?.userEmail?.trim().toLowerCase(),
      orgId: ctx?.orgId,
    }),
});
