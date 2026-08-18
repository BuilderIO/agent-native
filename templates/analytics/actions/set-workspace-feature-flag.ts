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
const schema = z.discriminatedUnion("operation", [
  z.object({
    appId: z.string().min(1),
    key: z.string().min(1),
    operation: z.literal("enable-for-current-user"),
  }),
  z.object({
    appId: z.string().min(1),
    key: z.string().min(1),
    operation: z.literal("off"),
  }),
  z.object({
    appId: z.string().min(1),
    key: z.string().min(1),
    operation: z.literal("replace-rules"),
    rules,
  }),
]);
export default defineAction({
  description:
    "Persist one feature-flag change on a trusted organization app. The app target is resolved only through the organization directory.",
  schema,
  agentInputSchema: z.object({
    appId: z.string(),
    key: z.string(),
    operation: z.enum(["enable-for-current-user", "off", "replace-rules"]),
    rules: rules.optional(),
  }),
  run: async (args, ctx) => {
    const admin = await requireAnalyticsAdminContext(ctx);
    return setWorkspaceFeatureFlag(admin, args);
  },
});
