import { defineAction, embedApp } from "@agent-native/core";
import { accessFilter, currentAccess } from "@agent-native/core/sharing";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { resolvePlanAccessContext } from "../server/lib/local-identity.js";
import { planStatusSchema, summarizePlans } from "../server/plans.js";

export default defineAction({
  description:
    "List Agent-Native Plan documents with section and comment summaries. Use this to find existing plans before creating a new one, or to check the status of plans in progress.",
  schema: z.object({
    status: planStatusSchema
      .optional()
      .describe(
        "Filter by plan status (draft, review, approved, in_progress, complete, archived). Omit to list all accessible plans.",
      ),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Maximum number of plans to return, ordered by most recently updated. Omit for all accessible plans.",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Plans",
      description:
        "Open the Agent-Native Plan index for existing plans and recaps.",
      iframeTitle: "Agent-Native Plan",
      openLabel: "Open Plans",
      height: 860,
    }),
  },
  run: async (args) => {
    // Project only the columns the list/summary needs. A bare `.select()` pulls
    // every column — including the large `html`, `markdown`, and `content`
    // blobs — for every plan the user can access, which is pure waste for a
    // list view and the main reason the plans-list skeleton lingered.
    const accessWhere = accessFilter(
      schema.plans,
      schema.planShares,
      resolvePlanAccessContext(currentAccess()),
    );
    const where = args.status
      ? and(accessWhere, eq(schema.plans.status, args.status))
      : accessWhere;
    const query = getDb()
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
        sourceUrl: schema.plans.sourceUrl,
        createdAt: schema.plans.createdAt,
        updatedAt: schema.plans.updatedAt,
        approvedAt: schema.plans.approvedAt,
      })
      .from(schema.plans)
      .where(where)
      .orderBy(desc(schema.plans.updatedAt));
    const rows = args.limit ? await query.limit(args.limit) : await query;
    return summarizePlans(rows);
  },
});
