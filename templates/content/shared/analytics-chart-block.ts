import {
  defineBlock,
  serializeSpecBlock,
  type BlockMdxConfig,
  type BlockSpec,
} from "@agent-native/core/blocks/server";
import {
  analyticsPanelCaptureSchema,
  checkEmbedAudience,
  type AnalyticsPanelCapture,
  type EmbedAudienceCheck,
  type EmbedVisibility,
} from "@agent-native/core/shared";

/**
 * A copy of one Analytics dashboard panel kept in a page: the numbers it
 * showed when someone added or refreshed it, how to draw them, and the link
 * back. Content never queries the data source; the copy changes only when an
 * editor refreshes it, so readers see exactly what the page says.
 */
export const ANALYTICS_CHART_BLOCK_TYPE = "analytics-chart";
export const ANALYTICS_CHART_TAG = "AnalyticsChart";

export type AnalyticsChartData = AnalyticsPanelCapture;

export const analyticsChartSchema = analyticsPanelCaptureSchema;

// A tag without its dashboard or panel reads with these empty values: the
// frame shows no link, nothing asks Analytics about it, and the schema check
// leaves it out of sharing checks, as it does any other malformed copy.
const MISSING_DASHBOARD: AnalyticsChartData["dashboard"] = {
  id: "",
  title: "",
  url: "",
  visibility: "private",
};
const MISSING_PANEL: AnalyticsChartData["panel"] = {
  id: "",
  title: "",
  type: "line",
  fingerprint: "",
  url: "",
};

export const analyticsChartMdx: BlockMdxConfig<AnalyticsChartData> = {
  tag: ANALYTICS_CHART_TAG,
  toAttrs: (data) => ({
    dashboard: data.dashboard,
    panel: data.panel,
    filters: data.filters,
    filterSummary: data.filterSummary,
    columns: data.columns,
    rows: data.rows,
    series: data.series,
    stacked: data.stacked,
    keyDates: data.keyDates,
    display: data.display,
    truncated: data.truncated,
    capturedAt: data.capturedAt,
  }),
  fromAttrs: (attrs) => ({
    dashboard:
      attrs.object<AnalyticsChartData["dashboard"]>("dashboard") ??
      MISSING_DASHBOARD,
    panel: attrs.object<AnalyticsChartData["panel"]>("panel") ?? MISSING_PANEL,
    filters: attrs.object<Record<string, string>>("filters") ?? {},
    filterSummary: attrs.string("filterSummary"),
    columns: attrs.array<string>("columns") ?? [],
    rows: attrs.array<AnalyticsChartData["rows"][number]>("rows") ?? [],
    series:
      attrs.array<NonNullable<AnalyticsChartData["series"]>[number]>("series"),
    stacked: attrs.bool("stacked"),
    keyDates:
      attrs.array<NonNullable<AnalyticsChartData["keyDates"]>[number]>(
        "keyDates",
      ),
    display:
      attrs.object<NonNullable<AnalyticsChartData["display"]>>("display"),
    truncated: attrs.bool("truncated") ?? false,
    capturedAt: attrs.string("capturedAt") ?? "",
  }),
};

const ServerReadStub = () => null;

export const analyticsChartBlockConfig: BlockSpec<AnalyticsChartData> =
  defineBlock<AnalyticsChartData>({
    type: ANALYTICS_CHART_BLOCK_TYPE,
    schema: analyticsChartSchema,
    mdx: analyticsChartMdx,
    Read: ServerReadStub,
    placement: ["block"],
    label: "Analytics chart",
    description:
      "A copy of one Analytics dashboard panel (chart, metric or table) with the numbers it showed when it was added or last refreshed, and a link back to the dashboard. Add or refresh one with capture-analytics-chart; never write its numbers by hand.",
  });

export function readAnalyticsChartData(
  data: unknown,
): AnalyticsChartData | null {
  const parsed = analyticsChartSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export function analyticsChartBlockRaw(
  blockId: string,
  data: AnalyticsChartData,
): string {
  return serializeSpecBlock(analyticsChartBlockConfig, { id: blockId, data });
}

/**
 * Tables list rows about named customers and accounts, so a table never
 * reaches more people than its dashboard does. Charts and metrics warn.
 */
export function isStrictAnalyticsChart(
  data: Pick<AnalyticsChartData, "panel">,
): boolean {
  return data.panel.type === "table";
}

/** One kept copy checked against the page's audience. */
export function analyticsChartAudience(
  action: "insert" | "widen",
  page: EmbedVisibility,
  data: Pick<AnalyticsChartData, "panel" | "dashboard">,
): EmbedAudienceCheck {
  return checkEmbedAudience({
    action,
    page,
    source: data.dashboard.visibility,
    strict: isStrictAnalyticsChart(data),
  });
}

/** The copies in a page that more people would see if it opened to `page`. */
export function analyticsChartsWiderThan(
  page: EmbedVisibility,
  charts: readonly Pick<AnalyticsChartData, "panel" | "dashboard">[],
): {
  warn: Pick<AnalyticsChartData, "panel" | "dashboard">[];
  block: Pick<AnalyticsChartData, "panel" | "dashboard">[];
} {
  const warn: Pick<AnalyticsChartData, "panel" | "dashboard">[] = [];
  const block: Pick<AnalyticsChartData, "panel" | "dashboard">[] = [];
  for (const chart of charts) {
    const { verdict } = analyticsChartAudience("widen", page, chart);
    if (verdict === "warn") warn.push(chart);
    if (verdict === "block") block.push(chart);
  }
  return { warn, block };
}

const TYPE_NAMES: Record<AnalyticsChartData["panel"]["type"], string> = {
  line: "Line chart",
  area: "Area chart",
  bar: "Bar chart",
  combo: "Combined bar and line chart",
  pie: "Pie chart",
  funnel: "Funnel",
  metric: "Metric",
  table: "Table",
};

/**
 * A one-sentence description of the copy for screen readers and anyone who
 * can't see the chart: what it shows, over which range, and the last value.
 */
export function describeAnalyticsChart(data: AnalyticsChartData): string {
  const what = `${TYPE_NAMES[data.panel.type]}: ${data.panel.title}, from the ${data.dashboard.title} dashboard`;
  const filters = data.filterSummary ? ` (${data.filterSummary})` : "";
  if (data.panel.type === "metric" && data.display) {
    return `${what}${filters}. ${data.display.value}${data.display.comparison ? `, ${data.display.comparison}` : ""}.`;
  }
  if (data.panel.type === "table") {
    return `${what}${filters}. ${data.rows.length} rows of ${data.columns.join(", ")}.`;
  }
  const { rows } = data;
  const first = rows.length > 0 ? rows[0] : null;
  const last = rows.length > 0 ? rows[rows.length - 1] : null;
  const range =
    first && last && first.length > 0 && last.length > 0
      ? ` ${rows.length} points from ${String(first[0])} to ${String(last[0])}.`
      : "";
  const latest = last
    ? data.columns
        .slice(1)
        .map((column, index) => {
          const value = index + 1 < last.length ? last[index + 1] : null;
          return value === null
            ? null
            : `${column} ${typeof value === "number" ? value.toLocaleString("en-US") : String(value)}`;
        })
        .filter((part): part is string => part !== null)
        .slice(0, 4)
        .join(", ")
    : "";
  return `${what}${filters}.${range}${latest ? ` Latest: ${latest}.` : ""}`;
}
