import { createHash } from "node:crypto";

import {
  ANALYTICS_CAPTURE_MAX_COLORS,
  ANALYTICS_CAPTURE_MAX_COLUMNS,
  ANALYTICS_CAPTURE_MAX_EVENTS,
  ANALYTICS_CAPTURE_MAX_ROWS,
  ANALYTICS_CAPTURE_MAX_TABLE_ROWS,
  ANALYTICS_CAPTURE_PANEL_TYPES,
  ANALYTICS_CAPTURE_SOURCES,
  analyticsCaptureChartConfigSchema,
  analyticsCaptureRecords,
  analyticsPanelCaptureSchema,
  analyticsPanelStatusSchema,
  type AnalyticsCaptureCell,
  type AnalyticsCaptureChartConfig,
  type AnalyticsCaptureEvent,
  type AnalyticsCapturePanelType,
  type AnalyticsCaptureSource,
  type AnalyticsPanelCapture,
  type AnalyticsPanelCaptureRequest,
  type AnalyticsPanelStatus,
  type AnalyticsPanelStatusRequest,
  type EmbedVisibility,
} from "@agent-native/core/shared";
import {
  axisDirection,
  isDateAxis,
} from "@agent-native/toolkit/dashboard/chart-axis-labels";
import { resolvePanelEvents } from "@agent-native/toolkit/dashboard/panel-events";
import {
  LEGACY_CHART_TYPE_ALIASES,
  limitChartRows,
  planPanelRender,
  stableStringify,
} from "@agent-native/toolkit/dashboard/panel-render-contract";
import { timeRangeDays } from "@agent-native/toolkit/dashboard/pivot";
import type {
  DashboardAnnotations,
  DashboardFilter,
  PanelEvent,
  SqlPanel,
  SqlPanelConfig,
} from "@agent-native/toolkit/dashboard/sql-dashboard-types";

import { keyDateEvents, panelEventsWithKeyDates } from "../../shared/key-dates";
import {
  readTrafficFilterValue,
  TRAFFIC_FILTER_ID,
  type TrafficEnvironment,
} from "../../shared/traffic-environment";
import type { AnnotationScope } from "./annotation-scope";
import type { DashboardPanelSource } from "./dashboard-panel-query";
import {
  buildPanelQuery,
  describeError,
  runResolvedPanel,
} from "./dashboard-panel-runner";
import {
  pageDashboardConfig,
  renderFingerprint,
  resolveVerificationVars,
} from "./dashboard-panel-verification";
import { buildDashboardUrl } from "./dashboard-report";
import { metricReading } from "./dashboard-report-render";
import {
  reportDashboardFromOpened,
  type AccessCtx,
} from "./dashboard-report-subscriptions";
import { listKeyDateSets } from "./key-dates-store";
import {
  openDashboard,
  openedDashboardVisibility,
  type OpenedDashboard,
} from "./open-dashboard";

const FILTER_PARAM_PREFIX = "f_";
const FILTER_SUMMARY_CHARS = 500;

/** Why a panel couldn't be captured, with the status an action should send. */
export class PanelCaptureError extends Error {
  constructor(
    message: string,
    readonly errorCode: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

type OpenedSqlDashboard = {
  opened: OpenedDashboard;
  id: string;
  title: string;
  visibility: EmbedVisibility;
  config: Record<string, unknown>;
  annotationScope: AnnotationScope;
};

/** A dashboard as the caller opens it, with who else can open it. */
async function openSqlDashboard(
  dashboardId: string,
  ctx: AccessCtx,
): Promise<OpenedSqlDashboard> {
  const opened = await openDashboard(dashboardId, ctx);
  if (!opened) {
    throw new PanelCaptureError(
      `Dashboard "${dashboardId}" was not found, or you don't have access to it.`,
      "dashboard_not_found",
      404,
    );
  }
  if (opened.saved && opened.saved.kind !== "sql") {
    throw new PanelCaptureError(
      `Only SQL dashboards can be kept in a page; "${dashboardId}" is ${opened.saved.kind}.`,
      "dashboard_not_sql",
      400,
    );
  }
  const report = reportDashboardFromOpened(opened, dashboardId, ctx);
  if (!report) {
    throw new PanelCaptureError(
      `Dashboard "${dashboardId}" was not found, or you don't have access to it.`,
      "dashboard_not_found",
      404,
    );
  }
  const config = pageDashboardConfig(
    opened.saved ? opened.saved.config : opened.builtin.config,
    dashboardId,
  );
  const name = typeof config.name === "string" ? config.name.trim() : "";
  return {
    opened,
    id: report.id,
    title: (name || report.title).slice(0, 300),
    visibility: await openedDashboardVisibility(opened, ctx),
    config,
    annotationScope: report.annotationScope,
  };
}

function panelsOf(config: Record<string, unknown>): SqlPanel[] {
  return Array.isArray(config.panels)
    ? (config.panels.filter(
        (panel) => !!panel && typeof panel === "object",
      ) as SqlPanel[])
    : [];
}

/**
 * Changes when the panel's saved query or chart settings change, or the
 * dashboard's filters or variables its query is built from: a filter's
 * default decides what a copy's Refresh runs. Labels are left out, as the
 * panel's title is, since they don't change the numbers.
 */
export function panelFingerprint(
  panel: SqlPanel,
  config: Record<string, unknown>,
): string {
  const filters = Array.isArray(config.filters)
    ? (config.filters as ReadonlyArray<DashboardFilter | null>).map(
        (filter) =>
          filter && {
            id: filter.id,
            type: filter.type,
            default: filter.default,
            customRange: filter.customRange,
            options: filter.options?.map((option) => option.value),
          },
      )
    : null;
  return createHash("sha256")
    .update(renderFingerprint(panel as unknown as Record<string, unknown>))
    .update(stableStringify({ filters, variables: config.variables }))
    .digest("hex")
    .slice(0, 12);
}

/** Filter values keyed by filter id, whichever form the caller sent. */
function unprefixedFilters(
  filters: Record<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters ?? {})) {
    const id = key.startsWith(FILTER_PARAM_PREFIX)
      ? key.slice(FILTER_PARAM_PREFIX.length)
      : key;
    if (id && id !== "tab" && id !== "tile") out[id] = value;
  }
  return out;
}

/**
 * The filters a reader would see on the dashboard, as one line: each
 * filter's label and the option it shows, defaults included.
 */
function filterSummary(
  config: Record<string, unknown>,
  filters: Readonly<Partial<Record<string, string>>>,
): string | undefined {
  const defined = Array.isArray(config.filters)
    ? (config.filters as ReadonlyArray<DashboardFilter | null>)
    : [];
  const parts: string[] = [];
  for (const filter of defined) {
    if (!filter?.id || filter.type === "toggle") continue;
    if (filter.type === "date-range") {
      const start = filters[`${filter.id}Start`];
      const end = filters[`${filter.id}End`];
      if (start || end) {
        parts.push(
          `${filter.label || filter.id}: ${start ?? ""} to ${end ?? ""}`,
        );
      }
      continue;
    }
    const value = filters[filter.id] ?? filter.default ?? "";
    if (!value) continue;
    const option = filter.options?.find((entry) => entry.value === value);
    parts.push(`${filter.label || filter.id}: ${option?.label ?? value}`);
  }
  const line = parts.join(" · ");
  return line ? line.slice(0, FILTER_SUMMARY_CHARS) : undefined;
}

function panelLink(
  dashboardId: string,
  panelId: string,
  filters: Record<string, string>,
): { dashboardUrl: string; panelUrl: string } {
  const dashboardUrl = buildDashboardUrl(
    dashboardId,
    Object.fromEntries(
      Object.entries(filters).map(([key, value]) => [
        `${FILTER_PARAM_PREFIX}${key}`,
        value,
      ]),
    ),
  );
  const panelUrl = new URL(dashboardUrl);
  panelUrl.searchParams.set("tile", panelId);
  return { dashboardUrl, panelUrl: panelUrl.toString() };
}

/**
 * Runs one dashboard panel as the caller, with the dashboard page's filters
 * and key dates, and returns the numbers a page keeps: the copy Content
 * draws, plus who can open the dashboard so the page can warn before its
 * readers outnumber the dashboard's.
 */
export async function captureDashboardPanel(
  request: AnalyticsPanelCaptureRequest,
  ctx: AccessCtx & {
    signal?: AbortSignal;
    timeoutMs: number;
    /** The action's result limit, in characters of pretty-printed JSON. */
    maxChars: number;
    now?: number;
  },
): Promise<AnalyticsPanelCapture> {
  const dashboard = await openSqlDashboard(request.dashboardId, {
    email: ctx.email,
    orgId: ctx.orgId,
  });
  const panel = panelsOf(dashboard.config).find(
    (candidate) => candidate.id === request.panelId,
  );
  if (!panel) {
    throw new PanelCaptureError(
      `Panel "${request.panelId}" is not in dashboard "${request.dashboardId}" any more.`,
      "panel_not_found",
      404,
    );
  }
  if (panel.chartType === "section" || panel.chartType === "extension") {
    throw new PanelCaptureError(
      `${panel.chartType} panels have no numbers to keep in a page.`,
      "panel_not_supported",
      400,
    );
  }

  const filters = unprefixedFilters(request.filters);
  const vars = resolveVerificationVars(dashboard.config, filters);
  let query: string;
  let trafficEnvironment: TrafficEnvironment | undefined;
  try {
    query = buildPanelQuery(panel, vars);
    // The page reads the dashboard's default traffic unless the link names one.
    trafficEnvironment =
      panel.source === "first-party"
        ? readTrafficFilterValue(
            vars[TRAFFIC_FILTER_ID] || filters[TRAFFIC_FILTER_ID],
          )
        : undefined;
  } catch (error) {
    throw new PanelCaptureError(describeError(error), "query_failed", 400);
  }

  const data = await runResolvedPanel({
    source: panel.source as DashboardPanelSource,
    query,
    ctx: { userEmail: ctx.email, orgId: ctx.orgId },
    timeoutMs: ctx.timeoutMs,
    ...(ctx.signal ? { signal: ctx.signal } : {}),
    ...(trafficEnvironment ? { trafficEnvironment } : {}),
  });
  if (data.status === "missing-credential") {
    throw new PanelCaptureError(data.message, "missing_credential", 409);
  }
  if (data.status !== "rows") {
    throw new PanelCaptureError(
      data.message,
      data.status === "query-failed" && data.timedOut
        ? "query_timed_out"
        : "query_failed",
      data.status === "query-failed" && data.timedOut ? 504 : 502,
    );
  }

  const annotations = dashboard.config.annotations as
    | DashboardAnnotations
    | undefined;
  const capturedAt = new Date(ctx.now ?? Date.now()).toISOString();
  const outcome = capturePanelRows({
    panel,
    rows: data.rows,
    truncated: data.truncated === true,
    keyDates: keyDateEvents(
      await listKeyDateSets(dashboard.annotationScope),
      annotations,
    ),
    timeRange: timeRangeDays(vars.timeRange),
    today: capturedAt.slice(0, 10),
  });
  if (outcome.status !== "captured") {
    throw new PanelCaptureError(
      outcome.message,
      outcome.status === "unsupported" ? "panel_not_supported" : "panel_empty",
      outcome.status === "unsupported" ? 400 : 422,
    );
  }

  const { type, ...kept } = outcome.capture;
  const source = captureSource(panel);
  const { dashboardUrl, panelUrl } = panelLink(dashboard.id, panel.id, filters);
  const summary = filterSummary(dashboard.config, filters);
  const capture = analyticsPanelCaptureSchema.parse({
    dashboard: {
      id: dashboard.id,
      title: dashboard.title,
      url: dashboardUrl,
      visibility: dashboard.visibility,
    },
    panel: {
      id: panel.id,
      title: (panel.title || panel.id).slice(0, 300),
      type,
      ...(source ? { source } : {}),
      fingerprint: panelFingerprint(panel, dashboard.config),
      url: panelUrl,
    },
    filters,
    ...(summary ? { filterSummary: summary } : {}),
    ...kept,
    capturedAt,
  });
  return fitCaptureToChars(capture, ctx.maxChars);
}

const CAPTURE_LABEL_CHARS = 200;
const CAPTURE_CELL_CHARS = 500;
const CAPTURE_DESCRIPTION_CHARS = 2000;

/** What a page keeps of one panel's result, before the dashboard details. */
export type PanelCaptureRows = Pick<
  AnalyticsPanelCapture,
  "chart" | "timeRange" | "columns" | "rows" | "display" | "truncated"
> & { type: AnalyticsCapturePanelType };

export type PanelCaptureOutcome =
  | { status: "captured"; capture: PanelCaptureRows }
  | { status: "unsupported" | "empty"; message: string };

/**
 * One panel's result as a copy another app keeps, such as a chart in a
 * Content page: the query's rows as the panel returned them, with the chart
 * settings and key dates the dashboard draws them with, so the page draws
 * them with the same toolkit chart. Panels a page can't keep yet, and
 * results with nothing to draw, come back with the reason instead, so a
 * failed capture never stands in for real numbers.
 */
export function capturePanelRows(args: {
  panel: SqlPanel;
  rows: Array<Record<string, unknown>>;
  truncated?: boolean;
  keyDates: readonly PanelEvent[];
  /** The dashboard's time range in days, which only a pivot reads. */
  timeRange?: number | undefined;
  /** The UTC day of the capture, YYYY-MM-DD: the chart's "today". */
  today: string;
}): PanelCaptureOutcome {
  const { panel } = args;
  const type = captureType(panel.chartType);
  if (!type) {
    return {
      status: "unsupported",
      message: `${panel.chartType} panels can't be kept in a page yet. Line, area, bar, combo, pie, funnel, metric and table panels can.`,
    };
  }
  const allColumns = Object.keys(args.rows[0] ?? {}).filter(
    (column) => column.length <= CAPTURE_LABEL_CHARS,
  );
  if (args.rows.length === 0 || allColumns.length === 0) {
    return {
      status: "empty",
      message: "This panel returned no rows, so there's nothing to keep.",
    };
  }

  const chart = captureChartConfig(panel.config);
  const rowLimit =
    type === "table"
      ? Math.min(
          chart.limit ?? ANALYTICS_CAPTURE_MAX_TABLE_ROWS,
          ANALYTICS_CAPTURE_MAX_TABLE_ROWS,
        )
      : ANALYTICS_CAPTURE_MAX_ROWS;
  // A metric adds up its rows, so fewer of them would show a different number.
  if (type === "metric" && args.rows.length > rowLimit) {
    return {
      status: "unsupported",
      message: `This metric adds up ${args.rows.length} rows, more than a page can keep.`,
    };
  }
  const timeRange = chart.pivot ? args.timeRange : undefined;
  const planOptions = renderOptions(timeRange, args.today);
  const chartPanel = capturedChartPanel(type, chart, captureSource(panel));
  const drawn = drawnColumns(chartPanel, args.rows, allColumns, planOptions);
  const columns = keptColumns(drawn, namedColumns(chart));
  const pivotXKey = chart.pivot?.xKey;
  const sourceRows = keepRows(
    args.rows,
    rowLimit,
    keepsEnd(type, axisValues(chartPanel, args.rows, planOptions)),
    pivotXKey === undefined ? null : (row) => captureCell(row[pivotXKey]),
  );
  const rows = sourceRows.map((row) =>
    columns.map((column) => captureCell(row[column])),
  );
  const records = analyticsCaptureRecords({ columns, rows });
  const plan = planPanelRender(records, chartPanel, planOptions);
  if (plan.empty) {
    return {
      status: "empty",
      message:
        type === "funnel"
          ? "This funnel returned no stages, so there's nothing to keep."
          : "This panel returned nothing to draw, so there's nothing to keep.",
    };
  }

  const events = eventsOnRows(
    panelEventsWithKeyDates(panel, args.keyDates),
    drawnXValues(chartPanel, records, planOptions),
  );
  const reading = type === "metric" ? metricReading(chartPanel, records) : null;
  return {
    status: "captured",
    capture: {
      type,
      chart: events.length > 0 ? { ...chart, events } : chart,
      ...(timeRange === undefined ? {} : { timeRange }),
      columns,
      rows,
      ...(reading
        ? {
            display: {
              value: reading.value.slice(0, CAPTURE_LABEL_CHARS),
              ...(reading.line
                ? { comparison: reading.line.text.slice(0, 300) }
                : {}),
            },
          }
        : {}),
      truncated:
        args.truncated === true ||
        sourceRows.length < args.rows.length ||
        columns.length < drawn.length,
    },
  };
}

function captureType(
  chartType: SqlPanel["chartType"],
): AnalyticsCapturePanelType | null {
  const type: string = LEGACY_CHART_TYPE_ALIASES[chartType] ?? chartType;
  return ANALYTICS_CAPTURE_PANEL_TYPES.find((entry) => entry === type) ?? null;
}

/** The panel's data source, when it's one a capture can name. */
function captureSource(
  panel: Pick<SqlPanel, "source">,
): AnalyticsCaptureSource | undefined {
  return ANALYTICS_CAPTURE_SOURCES.find((source) => source === panel.source);
}

/** How a capture plans its rows: the dashboard's range, ending on its day. */
function renderOptions(
  timeRange: number | undefined,
  today: string,
): { timeRange?: number; today: string } {
  return timeRange === undefined ? { today } : { timeRange, today };
}

/** The panel a page draws from a capture: its type, source and chart settings. */
function capturedChartPanel(
  type: AnalyticsCapturePanelType,
  chart: AnalyticsCaptureChartConfig,
  source: AnalyticsCaptureSource | undefined,
): SqlPanel {
  return {
    id: "capture",
    title: "",
    sql: "",
    source: source ?? "first-party",
    chartType: type,
    width: 1,
    config: chart as SqlPanelConfig,
  };
}

/**
 * The panel's chart settings that change the drawing, each kept only when the
 * capture contract allows it; its query, drilldown and key dates are not.
 */
function captureChartConfig(
  config: SqlPanelConfig | undefined,
): AnalyticsCaptureChartConfig {
  const shape = analyticsCaptureChartConfigSchema.shape;
  const kept: Record<string, unknown> = {};
  for (const key of Object.keys(shape) as Array<keyof typeof shape>) {
    if (key === "events") continue;
    const value = captureSetting(config, key);
    if (value === undefined) continue;
    const parsed = shape[key].safeParse(value);
    if (parsed.success) kept[key] = parsed.data;
  }
  return analyticsCaptureChartConfigSchema.parse(kept);
}

/**
 * One chart setting cut to what the contract holds, so a long one keeps its
 * start rather than failing whole. A table's hidden columns are left out:
 * the table never shows them.
 */
function captureSetting(
  config: SqlPanelConfig | undefined,
  key: keyof AnalyticsCaptureChartConfig,
): unknown {
  const value: unknown = config?.[key];
  if (key === "description" && typeof value === "string") {
    return value.slice(0, CAPTURE_DESCRIPTION_CHARS);
  }
  if (key === "columns" && Array.isArray(config?.columns)) {
    return config.columns
      .filter((column) => !column.hidden)
      .slice(0, ANALYTICS_CAPTURE_MAX_COLUMNS);
  }
  if (!Array.isArray(value)) return value;
  if (key === "yKeys" || key === "rightYKeys" || key === "barKeys") {
    return value.slice(0, ANALYTICS_CAPTURE_MAX_COLUMNS);
  }
  if (key === "colors") return value.slice(0, ANALYTICS_CAPTURE_MAX_COLORS);
  return value;
}

/**
 * The query columns the panel's drawing reads, in query order. A page keeps
 * only these, since everyone who can open the page can read every column it
 * keeps: a column the dashboard never shows stays in Analytics. If leaving
 * the others out would change the drawing, every column is kept instead.
 */
function drawnColumns(
  chartPanel: SqlPanel,
  rows: Array<Record<string, unknown>>,
  all: string[],
  planOptions: { timeRange?: number; today: string },
): string[] {
  const config = chartPanel.config ?? {};
  const read = new Set<string>();
  const add = (key: string | undefined) => {
    if (key) read.add(key);
  };
  if (chartPanel.chartType === "table") {
    const shown = (config.columns ?? []).filter((column) =>
      all.includes(column.key),
    );
    // A table with no shown column in its settings shows every column.
    if (shown.length === 0) return all;
    for (const column of shown) {
      add(column.key);
      add(column.linkKey);
    }
    return all.filter((column) => read.has(column));
  }
  if (chartPanel.chartType === "metric") {
    add(metricReading(chartPanel, rows).valueColumn);
    if (config.comparison) {
      add(config.comparison.previousKey ?? "previous_value");
      add(config.comparison.periodKey ?? "period");
    }
  } else {
    const plan = planPanelRender(rows, chartPanel, planOptions);
    if (config.pivot) {
      add(config.pivot.xKey);
      add(config.pivot.seriesKey);
      add(config.pivot.valueKey);
    } else {
      add(plan.xKey);
      for (const key of plan.yKeys) add(key);
      for (const key of config.rightYKeys ?? []) add(key);
      for (const key of config.barKeys ?? []) add(key);
    }
    if (plan.funnel) {
      add(plan.funnel.labelKey);
      add(plan.funnel.valueKey);
    }
    add(config.funnelOutcomes?.completedKey);
    add(config.funnelOutcomes?.leftKey);
    add(config.funnelOutcomes?.skippedKey);
    add(config.funnelOutcomes?.optionalKey);
  }
  const kept = all.filter((column) => read.has(column));
  const keptRows = rows.map((row) =>
    Object.fromEntries(kept.map((column) => [column, row[column]])),
  );
  return drawingOf(chartPanel, keptRows, planOptions) ===
    drawingOf(chartPanel, rows, planOptions)
    ? kept
    : all;
}

/** What a chart or metric draws from its rows, to compare column sets by. */
function drawingOf(
  chartPanel: SqlPanel,
  rows: Array<Record<string, unknown>>,
  planOptions: { timeRange?: number; today: string },
): string {
  if (chartPanel.chartType === "metric") {
    const reading = metricReading(chartPanel, rows);
    return stableStringify([reading.value, reading.line?.text ?? null]);
  }
  const plan = planPanelRender(rows, chartPanel, planOptions);
  const keys = [plan.xKey, ...plan.yKeys];
  return stableStringify({
    xKey: plan.xKey,
    yKeys: plan.yKeys,
    colorSlots: plan.colorSlots,
    rows: plan.rows.map((row) => keys.map((key) => captureCell(row[key]))),
    funnel: plan.funnel?.items ?? null,
  });
}

/**
 * The x values of the chart's axis, in the order it draws them. A pivot draws
 * one per date, whatever order its query returned the rows in.
 */
function axisValues(
  chartPanel: SqlPanel,
  rows: Array<Record<string, unknown>>,
  planOptions: { timeRange?: number; today: string },
): unknown[] {
  const plan = planPanelRender(rows, chartPanel, planOptions);
  return plan.rows.map((row) => row[plan.xKey]);
}

/**
 * The rows a capture keeps from one end when it can't keep them all. A
 * pivoted chart keeps only whole x values, since a date that lost some of
 * its rows would draw the missing series as zero. Its rows can come one
 * series after another, as Prometheus returns them, so it takes x values
 * from the end of the axis, in the order the pivot draws them.
 */
function keepRows<T>(
  rows: T[],
  keep: number,
  fromEnd: boolean,
  xOf: ((row: T) => AnalyticsCaptureCell) | null,
): T[] {
  if (rows.length <= keep) return rows;
  if (!xOf) {
    return fromEnd ? rows.slice(rows.length - keep) : rows.slice(0, keep);
  }
  const rowsPerX = new Map<string, number>();
  for (const row of rows) {
    const x = JSON.stringify(xOf(row));
    rowsPerX.set(x, (rowsPerX.get(x) ?? 0) + 1);
  }
  const axis = [...rowsPerX];
  if (fromEnd) axis.reverse();
  const keptX = new Set<string>();
  let kept = 0;
  for (const [x, count] of axis) {
    if (kept + count > keep) break;
    keptX.add(x);
    kept += count;
  }
  return rows.filter((row) => keptX.has(JSON.stringify(xOf(row))));
}

/** Columns the chart settings read, which a capture keeps before others. */
function namedColumns(chart: AnalyticsCaptureChartConfig): Set<string> {
  return new Set(
    [
      chart.xKey,
      chart.yKey,
      ...(chart.yKeys ?? []),
      ...(chart.rightYKeys ?? []),
      ...(chart.barKeys ?? []),
      chart.pivot?.xKey,
      chart.pivot?.seriesKey,
      chart.pivot?.valueKey,
      chart.funnelOutcomes?.completedKey,
      chart.funnelOutcomes?.leftKey,
      chart.funnelOutcomes?.skippedKey,
      chart.funnelOutcomes?.optionalKey,
      // A metric's comparison reads these when its settings name none.
      chart.comparison?.previousKey ?? "previous_value",
      chart.comparison?.periodKey ?? "period",
      ...(chart.columns ?? []).flatMap((column) => [
        column.key,
        column.linkKey,
      ]),
    ].filter((key): key is string => typeof key === "string"),
  );
}

/** At most the contract's columns, the named ones first, in query order. */
function keptColumns(all: string[], named: Set<string>): string[] {
  if (all.length <= ANALYTICS_CAPTURE_MAX_COLUMNS) return all;
  const keep = new Set(
    all
      .filter((column) => named.has(column))
      .slice(0, ANALYTICS_CAPTURE_MAX_COLUMNS),
  );
  for (const column of all) {
    if (keep.size >= ANALYTICS_CAPTURE_MAX_COLUMNS) break;
    keep.add(column);
  }
  return all.filter((column) => keep.has(column));
}

/**
 * Whether a capture with too many rows keeps its last ones. A chart over time
 * keeps its newest points, as the dashboard does: the last rows, or the first
 * when the query sorts newest first (ORDER BY date DESC). A bar chart keeps
 * its first bars unless they are dates in order, and a table, pie, funnel or
 * metric its first rows.
 */
function keepsEnd(
  type: AnalyticsCapturePanelType,
  xValues: readonly unknown[],
): boolean {
  if (
    type === "table" ||
    type === "pie" ||
    type === "funnel" ||
    type === "metric"
  ) {
    return false;
  }
  const direction = axisDirection(xValues);
  if (direction === "descending") return false;
  return type !== "bar" || (direction === "ascending" && isDateAxis(xValues));
}

function captureCell(value: unknown): AnalyticsCaptureCell {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? roundCaptureNumber(value) : null;
  }
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.slice(0, CAPTURE_CELL_CHARS);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  // Functions and symbols stringify to undefined.
  const json: unknown = JSON.stringify(value);
  return typeof json === "string" ? json.slice(0, CAPTURE_CELL_CHARS) : null;
}

/** The x values of the points a capture's chart draws. */
function drawnXValues(
  chartPanel: SqlPanel,
  records: Array<Record<string, unknown>>,
  planOptions: { timeRange?: number; today: string },
): unknown[] {
  const plan = planPanelRender(records, chartPanel, planOptions);
  return limitChartRows(plan.rows, chartPanel.chartType, plan.xKey).map(
    (row) => row[plan.xKey],
  );
}

/**
 * The events a capture's chart marks: the panel's own and the dashboard's
 * key dates that land on the rows it draws, as many as the contract keeps.
 * The rest of a long key-date list would only fill the copy.
 */
function eventsOnRows(
  events: unknown,
  xValues: readonly unknown[],
): AnalyticsCaptureEvent[] {
  return resolvePanelEvents(events, xValues)
    .slice(0, ANALYTICS_CAPTURE_MAX_EVENTS)
    .map((event) => ({
      date: event.date,
      ...(event.time ? { time: event.time } : {}),
      ...(event.timeZone ? { timeZone: event.timeZone } : {}),
      label: event.label.slice(0, CAPTURE_LABEL_CHARS),
      ...(event.color ? { color: event.color } : {}),
    }));
}

/**
 * Six significant digits are plenty to draw or read a number, but the digits
 * before the point, and two after it, are never rounded away.
 */
export function roundCaptureNumber(value: number): number {
  if (Number.isInteger(value) || !Number.isFinite(value)) return value;
  const wholeDigits = Math.max(1, Math.floor(Math.log10(Math.abs(value))) + 1);
  return Number(value.toPrecision(Math.min(15, Math.max(6, wholeDigits + 2))));
}

/**
 * Another app reads a capture as the action's pretty-printed result, which
 * the framework cuts off at the action's result limit, and a cut-off copy
 * can't be read at all. A capture over the limit keeps fewer rows instead,
 * and says so, keeping the rows the row cap would and the key dates that
 * still land on them.
 */
export function fitCaptureToChars(
  capture: AnalyticsPanelCapture,
  maxChars: number,
): AnalyticsPanelCapture {
  const size = (value: AnalyticsPanelCapture) =>
    JSON.stringify(value, null, 2).length;
  if (size(capture) <= maxChars) return capture;
  const tooLarge = new PanelCaptureError(
    "This panel's rows are too long to keep in a page.",
    "panel_too_large",
    413,
  );
  // A metric adds up its rows, so fewer of them would show a different number.
  if (capture.panel.type === "metric") throw tooLarge;
  const chartPanel = capturedChartPanel(
    capture.panel.type,
    capture.chart,
    capture.panel.source,
  );
  const planOptions = renderOptions(
    capture.timeRange,
    capture.capturedAt.slice(0, 10),
  );
  const fromEnd = keepsEnd(
    capture.panel.type,
    axisValues(chartPanel, analyticsCaptureRecords(capture), planOptions),
  );
  const pivotIndex = capture.chart.pivot
    ? capture.columns.indexOf(capture.chart.pivot.xKey)
    : -1;
  for (
    let keep = Math.floor(capture.rows.length * 0.8);
    keep >= 1;
    keep = Math.floor(keep * 0.8)
  ) {
    const rows = keepRows(
      capture.rows,
      keep,
      fromEnd,
      pivotIndex < 0 ? null : (row) => row[pivotIndex] ?? null,
    );
    if (rows.length === 0) continue;
    const fitted: AnalyticsPanelCapture = { ...capture, rows, truncated: true };
    if (capture.chart.events) {
      fitted.chart = {
        ...capture.chart,
        events: eventsOnRows(
          capture.chart.events,
          drawnXValues(
            chartPanel,
            analyticsCaptureRecords({ columns: capture.columns, rows }),
            planOptions,
          ),
        ),
      };
    }
    if (size(fitted) <= maxChars) return fitted;
  }
  throw tooLarge;
}

/**
 * Who can open a dashboard now, and each named panel's fingerprint, without
 * running any query: enough for a page to mark a kept chart as changed and
 * to check its readers against the dashboard's before it widens.
 */
export async function dashboardPanelStatus(
  request: AnalyticsPanelStatusRequest,
  ctx: AccessCtx,
): Promise<AnalyticsPanelStatus> {
  const dashboard = await openSqlDashboard(request.dashboardId, ctx);
  const panels = panelsOf(dashboard.config);
  return analyticsPanelStatusSchema.parse({
    dashboard: {
      id: dashboard.id,
      title: dashboard.title,
      visibility: dashboard.visibility,
    },
    panels: request.panelIds.map((id) => {
      const panel = panels.find((candidate) => candidate.id === id);
      return panel
        ? {
            id,
            fingerprint: panelFingerprint(panel, dashboard.config),
            type: String(panel.chartType).slice(0, 40),
          }
        : { id, fingerprint: null, type: null };
    }),
  });
}
