import {
  ANALYTICS_CHART_BLOCK_TYPE,
  ANALYTICS_CHART_TAG,
  readAnalyticsChartData,
  type AnalyticsChartData,
} from "./analytics-chart-block.js";
import { embedsInBody } from "./embeds-in-body.js";

/**
 * The Analytics charts a page body holds, wherever they sit (in toggles and
 * columns too). A tag that doesn't read as a chart is counted in
 * `unreadable`: its numbers can still be in the page, so nobody can say who
 * may see them.
 */
export async function analyticsChartsInBody(
  content: string | null | undefined,
): Promise<{ charts: AnalyticsChartData[]; unreadable: number }> {
  const { found, unreadable } = await embedsInBody(content, {
    tag: ANALYTICS_CHART_TAG,
    blockType: ANALYTICS_CHART_BLOCK_TYPE,
    read: readAnalyticsChartData,
  });
  return { charts: found, unreadable };
}
