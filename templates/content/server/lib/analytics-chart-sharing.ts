import { fail } from "@agent-native/core/action";
import type { EmbedVisibility } from "@agent-native/core/shared";

import { analyticsChartsWiderThan } from "../../shared/analytics-chart-block.js";
import { analyticsChartsInBody } from "../../shared/analytics-charts-in-body.js";

/**
 * Refuses to open a page to `visibility` when a table it holds would reach
 * more people than the table's dashboard. Charts and metrics only warn, in
 * the share dialog; tables list rows about named customers and accounts.
 */
export async function assertAnalyticsTablesFitAudience(
  content: unknown,
  visibility: EmbedVisibility,
): Promise<void> {
  if (visibility === "private" || typeof content !== "string") return;
  const { block } = analyticsChartsWiderThan(
    visibility,
    await analyticsChartsInBody(content),
  );
  if (block.length === 0) return;
  const titles = [...new Set(block.map((chart) => chart.dashboard.title))];
  fail(
    `This page has ${block.length === 1 ? "a table" : `${block.length} tables`} from ${titles.length === 1 ? `the ${titles[0]} dashboard` : `the ${titles.join(", ")} dashboards`}, which fewer people can open. A table can't reach more people than its dashboard. Remove it, or share the dashboard more widely in Analytics first.`,
    { errorCode: "analytics_table_wider_than_dashboard", statusCode: 409 },
  );
}
