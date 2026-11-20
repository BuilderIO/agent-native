import { and, eq, inArray, notInArray } from "drizzle-orm";

import { ANALYTICS_CHART_TAG } from "../../shared/analytics-chart-block.js";
import { analyticsChartDashboardIds } from "../../shared/analytics-charts-in-body.js";
import { getDb, schema } from "../db/index.js";

type Database = ReturnType<typeof getDb>;

export async function syncAnalyticsChartCitations(
  db: Database,
  input: { documentId: string; before?: string; after: string },
): Promise<void> {
  const tag = `<${ANALYTICS_CHART_TAG}`;
  if (!input.before?.includes(tag) && !input.after.includes(tag)) return;
  const dashboardIds = await analyticsChartDashboardIds(input.after);
  const citations = schema.analyticsChartCitations;
  await db
    .delete(citations)
    .where(
      dashboardIds.length
        ? and(
            eq(citations.documentId, input.documentId),
            notInArray(citations.dashboardId, dashboardIds),
          )
        : eq(citations.documentId, input.documentId),
    );
  if (!dashboardIds.length) return;
  await db
    .insert(citations)
    .values(
      dashboardIds.map((dashboardId) => ({
        documentId: input.documentId,
        dashboardId,
      })),
    )
    .onConflictDoNothing();
}

export async function clearAnalyticsChartCitations(
  db: Database,
  documentIds: string[],
): Promise<void> {
  if (!documentIds.length) return;
  await db
    .delete(schema.analyticsChartCitations)
    .where(inArray(schema.analyticsChartCitations.documentId, documentIds));
}
