import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema as dbSchema } from "../server/db/index.js";
import { requireAnalyticsAdminContext } from "../server/lib/db-admin-connections.js";
import { withFeatureFlagMutationLock } from "../server/lib/feature-flag-mutation-lock.js";
import { setWorkspaceFeatureFlag } from "../server/lib/workspace-feature-flags.js";

const rules = z.object({
  mode: z.enum(["off", "on", "rules"]),
  emails: z.array(z.string().email()).max(500).optional(),
  orgIds: z.array(z.string().min(1).max(200)).max(500).optional(),
  percentage: z.number().min(0).max(100).optional(),
  rolloutEpoch: z.string().min(1).max(200).optional(),
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
    return withFeatureFlagMutationLock(
      admin,
      {
        appId: args.appId,
        flagKey: args.key,
        operationId: `manual:${crypto.randomUUID()}`,
      },
      async () => {
        const [running] = await getDb()
          .select({ id: dbSchema.productExperiments.id })
          .from(dbSchema.productExperiments)
          .where(
            and(
              eq(dbSchema.productExperiments.orgId, admin.orgId),
              eq(dbSchema.productExperiments.appId, args.appId),
              eq(dbSchema.productExperiments.flagKey, args.key),
              eq(dbSchema.productExperiments.status, "running"),
            ),
          )
          .limit(1);
        if (running)
          throw new Error(
            "Pause or complete the running product experiment before editing its feature flag.",
          );
        return setWorkspaceFeatureFlag(admin, args);
      },
    );
  },
});
