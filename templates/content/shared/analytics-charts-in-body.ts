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

async function readRaw(raw: string): Promise<AnalyticsChartData | null> {
  try {
    const parsed = await parseRegistryBlockData(raw);
    return parsed?.type === ANALYTICS_CHART_BLOCK_TYPE
      ? readAnalyticsChartData(parsed.data)
      : null;
    // coercion-ok: a tag that doesn't parse is counted as unreadable by the caller
  } catch {
    return null;
  }
}

/**
 * The Analytics charts a page body holds, wherever they sit (in toggles and
 * columns too). A tag that doesn't read as a chart is counted in
 * `unreadable`: its numbers can still be in the page, so nobody can say who
 * may see them.
 */
export async function analyticsChartsInBody(
  content: string | null | undefined,
): Promise<{ charts: AnalyticsChartData[]; unreadable: number }> {
  if (!content || !content.includes(`<${ANALYTICS_CHART_TAG}`)) {
    return { charts: [], unreadable: 0 };
  }
  const raws: string[] = [];
  walk(nfmToDoc(content), (node) => {
    if (
      node.type === "registryBlock" &&
      node.attrs?.blockType === ANALYTICS_CHART_BLOCK_TYPE
    ) {
      raws.push(typeof node.attrs.__raw === "string" ? node.attrs.__raw : "");
    }
  });
  const read = await Promise.all(raws.map(readRaw));
  const charts = read.filter(
    (chart): chart is AnalyticsChartData => chart !== null,
  );
  return { charts, unreadable: read.length - charts.length };
}
