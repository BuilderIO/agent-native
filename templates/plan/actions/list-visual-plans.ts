import { defineAction } from "@agent-native/core";
import { accessFilter, currentAccess } from "@agent-native/core/sharing";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { resolvePlanAccessContext } from "../server/lib/local-identity.js";
import { planStatusSchema, summarizePlans } from "../server/plans.js";

export default defineAction({
  description:
    "List Agent-Native Plan documents with section and comment summaries.",
  schema: z.object({
    status: planStatusSchema.optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    // Project only the columns the list/summary needs. A bare `.select()` pulls
    // every column — including the large `html`, `markdown`, and `content`
    // blobs — for every plan the user can access, which is pure waste for a
    // list view and the main reason the plans-list skeleton lingered.
    const rows = await getDb()
      .select({
        id: schema.plans.id,
        title: schema.plans.title,
        brief: schema.plans.brief,
        kind: schema.plans.kind,
        status: schema.plans.status,
        source: schema.plans.source,
        repoPath: schema.plans.repoPath,
        currentFocus: schema.plans.currentFocus,
        hostedPlanId: schema.plans.hostedPlanId,
        hostedPlanUrl: schema.plans.hostedPlanUrl,
        createdAt: schema.plans.createdAt,
        updatedAt: schema.plans.updatedAt,
        approvedAt: schema.plans.approvedAt,
      })
      .from(schema.plans)
      .where(
        accessFilter(
          schema.plans,
          schema.planShares,
          resolvePlanAccessContext(currentAccess()),
        ),
      )
      .orderBy(desc(schema.plans.updatedAt));
    const filtered = args.status
      ? rows.filter((plan) => plan.status === args.status)
      : rows;
    return summarizePlans(filtered);
  },
});
