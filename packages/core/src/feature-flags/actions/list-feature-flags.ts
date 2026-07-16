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
    let manager;
    try {
      manager = await requireFeatureFlagManager(ctx ?? {});
    } catch (error) {
      if (
        error instanceof Error &&
        "statusCode" in error &&
        (error as { statusCode?: number }).statusCode === 403
      ) {
        return {
          contractVersion: 1,
          status: "forbidden" as const,
          reason: "forbidden" as const,
          flags: [],
          canManage: false,
        };
      }
      throw error;
    }
    if (definitions.length === 0)
      return {
        contractVersion: 1,
        status: "no-definitions" as const,
        reason: "no-definitions" as const,
        flags: [],
        canManage: true,
      };
    const flags = await Promise.all(
      definitions.map(async (definition) => ({
        ...definition,
        rules: await getFeatureFlagRules(definition.key, manager),
      })),
    );
    return {
      contractVersion: 1,
      status: "ready" as const,
      reason: "ready" as const,
      flags,
      canManage: true,
    };
  },
});
