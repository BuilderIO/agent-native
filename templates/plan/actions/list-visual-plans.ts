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
    const rows = await getDb()
      .select()
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
