import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { requireDashboardAccess } from "./_crm-dashboard.js";

const MAX_PIPELINE_RECORDS = 500;

export default defineAction({
  description:
    "Return bounded, access-scoped pipeline totals grouped by opportunity stage. This is the CRM-owned read source for the Pipeline dashboard data program.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx?: ActionRunContext) => {
    const access = requireDashboardAccess(ctx);
    const records = await getDb()
      .select({
        stage: schema.crmRecords.stage,
        amount: schema.crmRecords.amount,
      })
      .from(schema.crmRecords)
      .where(
        and(
          eq(schema.crmRecords.kind, "opportunity"),
          eq(schema.crmRecords.tombstone, false),
          accessFilter(schema.crmRecords, schema.crmRecordShares, access),
        ),
      )
      .orderBy(asc(schema.crmRecords.stage))
      .limit(MAX_PIPELINE_RECORDS);

    const stages = new Map<
      string,
      { stage: string; pipelineValue: number; opportunities: number }
    >();
    for (const record of records) {
      const stage = record.stage?.trim() || "Unstaged";
      const total = stages.get(stage) ?? {
        stage,
        pipelineValue: 0,
        opportunities: 0,
      };
      total.pipelineValue += Number.isFinite(record.amount)
        ? record.amount!
        : 0;
      total.opportunities += 1;
      stages.set(stage, total);
    }
    const rows = [...stages.values()].sort((a, b) =>
      a.stage.localeCompare(b.stage),
    );
    return {
      rows,
      truncated: records.length === MAX_PIPELINE_RECORDS,
      sourceRecordLimit: MAX_PIPELINE_RECORDS,
    };
  },
});
