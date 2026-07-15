import { z } from "zod";

import { defineAction } from "../../action.js";
import { requireFeatureFlagManager } from "../permissions.js";
import { listFeatureFlags } from "../registry.js";
import { getFeatureFlagRules } from "../store.js";

export default defineAction({
  description:
    "List this app's registered feature flags and their current rules. Organization owner/admin only (or the explicit no-org administrator).",
  schema: z.object({}),
  http: { method: "GET" },
  toolCallable: false,
  run: async (_args, ctx) => {
    const definitions = listFeatureFlags();
    if (definitions.length === 0) return { flags: [], canManage: false };
    let manager;
    try {
      manager = await requireFeatureFlagManager(ctx ?? {});
    } catch (error) {
      if (
        error instanceof Error &&
        "statusCode" in error &&
        (error as { statusCode?: number }).statusCode === 403
      ) {
        return { flags: [], canManage: false };
      }
      throw error;
    }
    const flags = await Promise.all(
      definitions.map(async (definition) => ({
        ...definition,
        rules: await getFeatureFlagRules(definition.key, manager),
      })),
    );
    return { flags, canManage: true };
  },
});
