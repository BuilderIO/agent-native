import { z } from "zod";

import { defineAction } from "../../action.js";
import { requireFeatureFlagManager } from "../permissions.js";
import { getFeatureFlagDefinition } from "../registry.js";
import {
  defaultFeatureFlagRules,
  getFeatureFlagRules,
  normalizeFeatureFlagRules,
  putFeatureFlagRules,
} from "../store.js";

const rulesSchema = z.object({
  mode: z.enum(["off", "on", "rules"]),
  emails: z.array(z.string().email()).max(500).optional(),
  orgIds: z.array(z.string().min(1).max(200)).max(500).optional(),
  percentage: z.number().min(0).max(100).optional(),
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

    let rules;
    if (args.operation === "off") {
      rules = defaultFeatureFlagRules();
    } else if (args.operation === "replace-rules") {
      rules = normalizeFeatureFlagRules(args.rules);
    } else {
      const current = await getFeatureFlagRules(args.key, manager);
      rules = normalizeFeatureFlagRules({
        ...current,
        // A globally-on flag already includes this user. Do not accidentally
        // narrow it to a one-email rollout while recording the operator edit.
        mode: current.mode === "on" ? "on" : "rules",
        emails: [...current.emails, manager.email],
      });
    }
    rules = { ...rules, updatedAt: Date.now(), updatedBy: manager.email };

    await putFeatureFlagRules(args.key, manager, rules);
    const persistedRules = await getFeatureFlagRules(args.key, manager);
    return {
      key: args.key,
      rules: persistedRules,
      scope: { orgId: manager.orgId },
    };
  },
});
