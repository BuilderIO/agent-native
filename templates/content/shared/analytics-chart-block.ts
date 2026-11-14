import {
  defineBlock,
  serializeSpecBlock,
  type BlockMdxConfig,
  type BlockSpec,
} from "@agent-native/core/blocks/server";
import {
  analyticsCaptureRecords,
  analyticsPanelCaptureSchema,
  checkEmbedAudience,
  type AnalyticsPanelCapture,
  type EmbedAudienceCheck,
  type EmbedVisibility,
} from "@agent-native/core/shared";
import { planPanelRender } from "@agent-native/toolkit/dashboard/panel-render-contract";
import type {
  SqlPanel,
  SqlPanelConfig,
} from "@agent-native/toolkit/dashboard/sql-dashboard-types";

/**
 * A copy of one Analytics dashboard panel kept in a page: the rows it
 * showed when someone added or refreshed it, the chart settings the
 * dashboard draws them with, and the link back. Content never queries the data source; the copy changes only when an
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
    chart: data.chart,
    columns: data.columns,
    timeRange: data.timeRange,
    rows: data.rows,
    display: data.display,
    truncated: data.truncated,
    capturedAt: data.capturedAt,
  }),
  fromAttrs: (attrs) => {
    const timeRange = attrs.number("timeRange");
    return {
      dashboard:
        attrs.object<AnalyticsChartData["dashboard"]>("dashboard") ??
        MISSING_DASHBOARD,
      panel:
        attrs.object<AnalyticsChartData["panel"]>("panel") ?? MISSING_PANEL,
      filters: attrs.object<Record<string, string>>("filters") ?? {},
      filterSummary: attrs.string("filterSummary"),
      chart: attrs.object<AnalyticsChartData["chart"]>("chart") ?? {},
      ...(timeRange === undefined ? {} : { timeRange }),
      columns: attrs.array<string>("columns") ?? [],
      rows: attrs.array<AnalyticsChartData["rows"][number]>("rows") ?? [],
      display:
        attrs.object<NonNullable<AnalyticsChartData["display"]>>("display"),
      truncated: attrs.bool("truncated") ?? false,
      capturedAt: attrs.string("capturedAt") ?? "",
    };
  },
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
      "A copy of one Analytics dashboard panel (chart, metric or table) with the rows it showed when it was added or last refreshed, drawn as the dashboard draws them, and a link back to the dashboard. Add or refresh one with capture-analytics-chart; never write its numbers by hand.",
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

/** The dashboard panel a copy draws as: its type, source and chart settings. */
export function analyticsChartPanel(data: AnalyticsChartData): SqlPanel {
  return {
    id: data.panel.id,
    title: data.panel.title,
    sql: "",
    source: data.panel.source ?? "first-party",
    chartType: data.panel.type,
    width: 1,
    config: data.chart as SqlPanelConfig,
  };
}

/**
 * How a copy plans its rows: a pivot fills the dashboard's time range,
 * ending on the day of the copy rather than today.
 */
export function analyticsChartPlanOptions(data: AnalyticsChartData): {
  timeRange?: number;
  today?: string;
} {
  const capturedAt = new Date(data.capturedAt);
  return {
    ...(data.timeRange === undefined ? {} : { timeRange: data.timeRange }),
    ...(Number.isNaN(capturedAt.getTime())
      ? {}
      : { today: capturedAt.toISOString().slice(0, 10) }),
  };
}

/** A list's item at `index`, or undefined past its ends. */
function itemAt<T>(list: readonly T[], index: number): T | undefined {
  return list[index];
}

function describeValue(value: unknown): string {
  return typeof value === "number"
    ? value.toLocaleString("en-US")
    : typeof value === "string"
      ? value
      : JSON.stringify(value);
}

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
  // The points the chart draws, after any pivot, as the dashboard plans them.
  const { rows, xKey, yKeys } = planPanelRender(
    analyticsCaptureRecords(data),
    analyticsChartPanel(data),
    analyticsChartPlanOptions(data),
  );
  const first = itemAt(rows, 0);
  const last = itemAt(rows, rows.length - 1);
  const range =
    first && last
      ? ` ${rows.length} points from ${describeValue(first[xKey])} to ${describeValue(last[xKey])}.`
      : "";
  const latest = last
    ? yKeys
        .filter((key) => last[key] !== null && last[key] !== undefined)
        .slice(0, 4)
        .map(
          (key) =>
            `${data.chart.seriesLabels?.[key] ?? key} ${describeValue(last[key])}`,
        )
        .join(", ")
    : "";
  return `${what}${filters}.${range}${latest ? ` Latest: ${latest}.` : ""}`;
}
