import {
  ANALYTICS_CHART_BLOCK_TYPE,
  ANALYTICS_CHART_TAG,
  readAnalyticsChartData,
  type AnalyticsChartData,
} from "./analytics-chart-block.js";
import { parseRegistryBlockData } from "./nfm-registry.js";
import { nfmToDoc, type PMNode } from "./nfm.js";

function walk(node: PMNode | undefined, visit: (node: PMNode) => void) {
  if (!node) return;
  visit(node);
  for (const child of node.content ?? []) walk(child, visit);
}

/**
 * The Analytics charts a page body holds, wherever they sit (in toggles and
 * columns too). A chart whose source no longer parses is left out.
 */
export async function analyticsChartsInBody(
  content: string | null | undefined,
): Promise<AnalyticsChartData[]> {
  if (!content || !content.includes(`<${ANALYTICS_CHART_TAG}`)) return [];
  const raws: string[] = [];
  walk(nfmToDoc(content), (node) => {
    if (
      node.type === "registryBlock" &&
      node.attrs?.blockType === ANALYTICS_CHART_BLOCK_TYPE &&
      typeof node.attrs.__raw === "string"
    ) {
      raws.push(node.attrs.__raw);
    }
  });
  const charts = await Promise.all(
    raws.map(async (raw) => {
      try {
        const parsed = await parseRegistryBlockData(raw);
        return parsed?.type === ANALYTICS_CHART_BLOCK_TYPE
          ? readAnalyticsChartData(parsed.data)
          : null;
      } catch {
        return null;
      }
    }),
  );
  return charts.filter((chart): chart is AnalyticsChartData => chart !== null);
}
