import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requireAnalyticsAdminContext } from "../server/lib/db-admin-connections.js";
import { setWorkspaceFeatureFlag } from "../server/lib/workspace-feature-flags.js";

const rules = z.object({
  mode: z.enum(["off", "on", "rules"]),
  emails: z.array(z.string().email()).max(500).optional(),
  orgIds: z.array(z.string().min(1).max(200)).max(500).optional(),
  percentage: z.number().int().min(0).max(100).optional(),
});
const scope = z
  .enum(["org", "global"])
  .optional()
  .describe(
    "Which rule to change: `org` (default) is the active organization's own rule; `global` is the rule for every organization and needs the target app's feature flag admin list.",
  );
const schema = z.discriminatedUnion("operation", [
  z.object({
    appId: z.string().min(1),
    key: z.string().min(1),
    operation: z.literal("enable-for-current-user"),
    scope,
  }),
  z.object({
    appId: z.string().min(1),
    key: z.string().min(1),
    operation: z.literal("off"),
    scope,
  }),
  z.object({
    appId: z.string().min(1),
    key: z.string().min(1),
    operation: z.literal("replace-rules"),
    scope,
    rules,
  }),
]);
export default defineAction({
  description:
    "Persist one feature-flag change on Analytics or a trusted organization app and report which rule was written. An organization's own rule replaces the rule for every organization, so a global change does not reach an organization that has its own rule. Analytics uses its local flag action; peer targets are resolved through the organization directory.",
  schema,
  agentInputSchema: z.object({
    appId: z.string(),
    key: z.string(),
    operation: z.enum(["enable-for-current-user", "off", "replace-rules"]),
    scope,
    rules: rules.optional(),
  }),
  run: async (args, ctx) => {
    const admin = await requireAnalyticsAdminContext(ctx);
    return setWorkspaceFeatureFlag(admin, args, ctx);
  },
});
