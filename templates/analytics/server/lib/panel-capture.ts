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
import { keyDateEvents } from "../../shared/key-dates";
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
import { openDashboard, type OpenedDashboard } from "./open-dashboard";

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

/**
 * A dashboard as the caller opens it. Built-in dashboards open for everyone
 * in the organization, so they count as organization-wide.
 */
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
    visibility: opened.saved?.visibility ?? "org",
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

/** Changes when the panel's saved query or chart settings change. */
export function panelFingerprint(panel: SqlPanel): string {
  return createHash("sha256")
    .update(renderFingerprint(panel as unknown as Record<string, unknown>))
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
  ctx: AccessCtx & { signal?: AbortSignal; timeoutMs: number; now?: number },
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
    truncated: data.truncated,
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
  return analyticsPanelCaptureSchema.parse({
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
      fingerprint: panelFingerprint(panel),
      url: panelUrl,
    },
    filters,
    ...(summary ? { filterSummary: summary } : {}),
    ...numbers,
    capturedAt: new Date(now).toISOString(),
  });
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
            fingerprint: panelFingerprint(panel),
            type: String(panel.chartType).slice(0, 40),
          }
        : { id, fingerprint: null, type: null };
    }),
  });
}
