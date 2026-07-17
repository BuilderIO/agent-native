import { z } from "zod";

import { defineAction } from "../../action.js";
import { requireFeatureFlagManager } from "../permissions.js";
import { getFeatureFlagDefinition } from "../registry.js";
import {
  defaultFeatureFlagRules,
  mutateFeatureFlagRules,
  normalizeFeatureFlagRules,
} from "../store.js";

const rulesSchema = z.object({
  mode: z.enum(["off", "on", "rules"]),
  emails: z.array(z.string().email()).max(500).optional(),
  orgIds: z.array(z.string().min(1).max(200)).max(500).optional(),
  percentage: z.number().int().min(0).max(100).optional(),
});

const schema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("enable-for-current-user"),
    key: z.string(),
  }),
  z.object({ operation: z.literal("off"), key: z.string() }),
  z.object({
    operation: z.literal("replace-rules"),
    key: z.string(),
    rules: rulesSchema,
  }),
]);

export default defineAction({
  description:
    "Atomically manage one registered feature flag: enable it for the current user, turn it off immediately for the active scope, or replace its full rules. Organization owner/admin only (or the explicit no-org administrator).",
  schema,
  // Keep the strict discriminated union for runtime validation, but advertise
  // an object-shaped schema so agent tool registries can expose the action.
  // Root-level JSON Schema unions are intentionally rejected by the agent.
  agentInputSchema: z.object({
    operation: z.enum(["enable-for-current-user", "off", "replace-rules"]),
    key: z.string(),
    rules: rulesSchema.optional(),
  }),
  toolCallable: false,
  audit: {
    target: (args, _result, meta) => ({
      type: "feature-flag",
      id: args.key,
      ownerEmail: meta.userEmail,
      visibility: meta.orgId ? "org" : "private",
    }),
    summary: (args) => `Feature flag ${args.key}: ${args.operation}`,
  },
  run: async (args, ctx) => {
    const manager = await requireFeatureFlagManager(ctx ?? {});
    if (!getFeatureFlagDefinition(args.key)) {
      throw new Error(`Unknown feature flag: ${args.key}`);
    }

    const persistedRules = await mutateFeatureFlagRules(
      args.key,
      manager,
      (current) => {
        let rules;
        if (args.operation === "off") {
          rules = defaultFeatureFlagRules();
        } else if (args.operation === "replace-rules") {
          rules = normalizeFeatureFlagRules(args.rules);
        } else {
          rules = normalizeFeatureFlagRules({
            ...current,
            // A globally-on flag already includes this user. Do not
            // accidentally narrow it to a one-email rollout.
            mode: current.mode === "on" ? "on" : "rules",
            emails: [...current.emails, manager.email],
          });
        }
        return { ...rules, updatedAt: Date.now(), updatedBy: manager.email };
      },
    );
    return {
      contractVersion: 1 as const,
      status: "ready" as const,
      key: args.key,
      rules: persistedRules,
      scope: { orgId: manager.orgId },
    };
  },
});
