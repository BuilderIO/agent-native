import { analyticsPanelStatusRequestSchema } from "@agent-native/core/shared";

import {
  ANALYTICS_CHART_BLOCK_TYPE,
  ANALYTICS_CHART_TAG,
  readAnalyticsChartData,
  type AnalyticsChartData,
} from "./analytics-chart-block.js";
import { parseRegistryBlockData } from "./nfm-registry.js";
import { nfmToDoc, type PMNode } from "./nfm.js";

const dashboardIdSchema = analyticsPanelStatusRequestSchema.shape.dashboardId;
const ATTRIBUTE = /\s+([A-Za-z_][\w-]*)(=?)/y;

function walk(node: PMNode | undefined, visit: (node: PMNode) => void) {
  if (!node) return;
  visit(node);
  for (const child of node.content ?? []) walk(child, visit);
}

function chartTags(content: string): string[] {
  const raws: string[] = [];
  walk(nfmToDoc(content), (node) => {
    if (
      node.type === "registryBlock" &&
      node.attrs?.blockType === ANALYTICS_CHART_BLOCK_TYPE
    ) {
      raws.push(typeof node.attrs.__raw === "string" ? node.attrs.__raw : "");
    }
  });
  return raws;
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

function expressionEnd(tag: string, start: number): number {
  let depth = 0;
  for (let at = start; at < tag.length; at++) {
    const char = tag[at];
    if (char === '"') {
      for (at++; at < tag.length && tag[at] !== '"'; at++) {
        if (tag[at] === "\\") at++;
      }
    } else if (char === "{") {
      depth++;
    } else if (char === "}" && --depth === 0) {
      return at + 1;
    }
  }
  return -1;
}

function jsonAttribute(
  tag: string,
  name: string,
  start = tag.length - tag.trimStart().length,
): unknown {
  const open = `<${ANALYTICS_CHART_TAG}`;
  if (!tag.startsWith(open, start)) return undefined;
  let at = start + open.length;
  for (;;) {
    ATTRIBUTE.lastIndex = at;
    const match = ATTRIBUTE.exec(tag);
    if (!match) return undefined;
    at = ATTRIBUTE.lastIndex;
    if (!match[2]) continue;
    if (tag[at] === '"') {
      const close = tag.indexOf('"', at + 1);
      if (close === -1) return undefined;
      at = close + 1;
      continue;
    }
    if (tag[at] !== "{") return undefined;
    const end = expressionEnd(tag, at);
    if (end === -1) return undefined;
    if (match[1] === name) {
      try {
        return JSON.parse(tag.slice(at + 1, end - 1));
        // coercion-ok: a value that isn't JSON is read by the full MDX parse instead
      } catch {
        return undefined;
      }
    }
    at = end;
  }
}

function dashboardIdIn(dashboard: unknown): string | null {
  const id = dashboardIdSchema.safeParse(
    (dashboard as { id?: unknown } | null)?.id,
  );
  return id.success ? id.data : null;
}

async function dashboardIdOf(raw: string): Promise<string | null> {
  const dashboard = jsonAttribute(raw, "dashboard");
  if (dashboard !== undefined) return dashboardIdIn(dashboard);
  try {
    const parsed = await parseRegistryBlockData(raw);
    return parsed?.type === ANALYTICS_CHART_BLOCK_TYPE
      ? dashboardIdIn((parsed.data as { dashboard?: unknown }).dashboard)
      : null;
    // coercion-ok: a tag that doesn't parse names no dashboard to cite
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
  const read = await Promise.all(chartTags(content).map(readRaw));
  const charts = read.filter(
    (chart): chart is AnalyticsChartData => chart !== null,
  );
  return { charts, unreadable: read.length - charts.length };
}

export async function analyticsChartDashboardIds(
  content: string | null | undefined,
): Promise<string[]> {
  if (!content || !content.includes(`<${ANALYTICS_CHART_TAG}`)) return [];
  const ids = await Promise.all(chartTags(content).map(dashboardIdOf));
  return [...new Set(ids.filter((id): id is string => id !== null))];
}

export async function chartTagNamesDashboard(
  content: string,
  dashboardId: string,
): Promise<boolean> {
  const open = `<${ANALYTICS_CHART_TAG}`;
  for (
    let at = content.indexOf(open);
    at !== -1;
    at = content.indexOf(open, at + open.length)
  ) {
    const dashboard = jsonAttribute(content, "dashboard", at);
    if (dashboard === undefined) {
      return (await analyticsChartDashboardIds(content)).includes(dashboardId);
    }
    if (dashboardIdIn(dashboard) === dashboardId) return true;
  }
  return false;
}
