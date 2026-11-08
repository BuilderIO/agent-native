import { createHash } from "node:crypto";

import {
  analyticsPanelCaptureSchema,
  analyticsPanelStatusSchema,
  type AnalyticsPanelCapture,
  type AnalyticsPanelCaptureRequest,
  type AnalyticsPanelStatus,
  type AnalyticsPanelStatusRequest,
  type EmbedVisibility,
} from "@agent-native/core/shared";

import type {
  DashboardAnnotations,
  DashboardFilter,
  SqlPanel,
} from "../../app/pages/adhoc/sql-dashboard/types";
import { axisDirection } from "../../shared/chart-axis-labels";
import { keyDateEvents } from "../../shared/key-dates";
import { stableStringify } from "../../shared/panel-render-contract";
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
import { capturePanelNumbers } from "./dashboard-report-render";
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

  const now = ctx.now ?? Date.now();
  const annotations = dashboard.config.annotations as
    | DashboardAnnotations
    | undefined;
  const outcome = capturePanelNumbers({
    panel,
    rows: data.rows,
    truncated: data.truncated === true,
    vars,
    keyDates: keyDateEvents(
      await listKeyDateSets(dashboard.annotationScope),
      annotations,
    ),
    now,
  });
  if (outcome.status !== "captured") {
    throw new PanelCaptureError(
      outcome.message,
      outcome.status === "unsupported" ? "panel_not_supported" : "panel_empty",
      outcome.status === "unsupported" ? 400 : 422,
    );
  }

  const { type, ...numbers } = outcome.numbers;
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
      fingerprint: panelFingerprint(panel, dashboard.config),
      url: panelUrl,
    },
    filters,
    ...(summary ? { filterSummary: summary } : {}),
    ...numbers,
    rows: numbers.rows.map((row) =>
      row.map((cell) =>
        typeof cell === "number" ? roundCaptureNumber(cell) : cell,
      ),
    ),
    capturedAt: new Date(now).toISOString(),
  });
  return fitCaptureToChars(capture, ctx.maxChars);
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
 * and says so: a chart its latest points, as the row cap does, and a table,
 * pie or funnel its first rows.
 */
export function fitCaptureToChars(
  capture: AnalyticsPanelCapture,
  maxChars: number,
): AnalyticsPanelCapture {
  const size = (value: AnalyticsPanelCapture) =>
    JSON.stringify(value, null, 2).length;
  if (size(capture) <= maxChars) return capture;
  const type = capture.panel.type;
  // A chart keeps its newest points, which open the rows when the query
  // sorts newest first (ORDER BY date DESC).
  const keepsEnd =
    type !== "table" &&
    type !== "pie" &&
    type !== "funnel" &&
    axisDirection(capture.rows.map((row) => row[0])) !== "descending";
  for (
    let keep = Math.floor(capture.rows.length * 0.8);
    keep >= 1;
    keep = Math.floor(keep * 0.8)
  ) {
    const rows = keepsEnd
      ? capture.rows.slice(capture.rows.length - keep)
      : capture.rows.slice(0, keep);
    const labels = new Set(rows.map((row) => String(row[0])));
    const fitted: AnalyticsPanelCapture = {
      ...capture,
      rows,
      truncated: true,
      ...(capture.keyDates
        ? {
            keyDates: capture.keyDates.filter((date) => labels.has(date.x)),
          }
        : {}),
    };
    if (size(fitted) <= maxChars) return fitted;
  }
  throw new PanelCaptureError(
    "This panel's rows are too long to keep in a page.",
    "panel_too_large",
    413,
  );
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
