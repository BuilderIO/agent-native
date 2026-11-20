import { defineAction } from "@agent-native/core/action";
import { and, eq, notInArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { firstRow } from "../server/lib/first-row.js";
import { analyticsChartsInBody } from "../shared/analytics-charts-in-body.js";
import {
  analyticsChartDocumentIdSchema,
  authorizeAnalyticsChartPage,
} from "./_analytics-chart-access.js";

export default defineAction({
  description:
    "After adding, refreshing or removing an Analytics chart in a page with edit-document, record which dashboards the page's saved body holds charts from, so each dashboard's Cited in list shows the page. Editors only; reads the saved page and runs no query.",
  schema: z.object({ documentId: analyticsChartDocumentIdSchema }),
  outputSchema: z.object({
    dashboardIds: z.array(z.string()),
    unreadable: z.number(),
  }),
  http: { method: "POST" },
  mcpTool: true,
  run: async ({ documentId }) => {
    await authorizeAnalyticsChartPage(documentId, "editor");
    const db = getDb();
    // guard:allow-unscoped — the caller's edit access to this page was checked above.
    const page = firstRow(
      await db
        .select({ content: schema.documents.content })
        .from(schema.documents)
        .where(eq(schema.documents.id, documentId))
        .limit(1),
    );
    const { charts, unreadable } = await analyticsChartsInBody(page?.content);
    const dashboardIds = [
      ...new Set(
        charts.map((chart) => chart.dashboard.id).filter((id) => id !== ""),
      ),
    ];
    const citations = schema.analyticsChartCitations;
    await db
      .delete(citations)
      .where(
        dashboardIds.length
          ? and(
              eq(citations.documentId, documentId),
              notInArray(citations.dashboardId, dashboardIds),
            )
          : eq(citations.documentId, documentId),
      );
    if (dashboardIds.length) {
      await db
        .insert(citations)
        .values(
          dashboardIds.map((dashboardId) => ({ documentId, dashboardId })),
        )
        .onConflictDoNothing();
    }
    return { dashboardIds, unreadable };
  },
});
