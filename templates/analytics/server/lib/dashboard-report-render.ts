import {
  resolveOgFontFiles,
  runWithRequestContext,
} from "@agent-native/core/server";

import { resolveDualAxis } from "../../app/pages/adhoc/sql-dashboard/dual-axis";
import { interpolate } from "../../app/pages/adhoc/sql-dashboard/interpolate";
import { serializePanelSql } from "../../app/pages/adhoc/sql-dashboard/panel-sql";
import { pivotRows } from "../../app/pages/adhoc/sql-dashboard/pivot";
import type {
  ColumnFormat,
  SqlDashboardConfig,
  SqlPanel,
  TableColumnConfig,
} from "../../app/pages/adhoc/sql-dashboard/types";
import { resolveDashboardFunnelRows } from "../../shared/dashboard-funnel";
import { DASHBOARD_REPORT_ACTION_TIMEOUT_MS } from "../../shared/dashboard-report-timeouts.js";
import {
  MAX_CONCURRENT_FIRST_PARTY_SQL_QUERIES,
  MAX_CONCURRENT_SQL_QUERIES,
} from "../../shared/sql-query-limits";
import {
  normalizeDashboardPanelQuery,
  type DashboardPanelSource,
} from "./dashboard-panel-query";
import { resolveAnalyticsPanelSource } from "./dashboard-panel-source-resolver";
import {
  renderReportChartSvg,
  renderFunnelChartSvg,
  REPORT_CHART_FONT_FAMILY,
  type ReportChartSeries,
  type ReportChartType,
  type ReportChartValueFormatter,
} from "./report-chart-svg";

export type ReportSnapshot = {
  dashboardId: string;
  title: string;
  description?: string;
  filters: Record<string, string>;
  dashboardUrl: string;
  reportSettingsUrl: string;
  generatedAt: string;
  panelIds: string[];
  panels: SqlDashboardConfig["panels"];
  variables?: Record<string, string>;
};

export type ReportPanelData =
  | {
      status: "rows";
      rows: Array<Record<string, unknown>>;
      schema: Array<{ name: string; type: string }>;
      truncated?: boolean;
    }
  | { status: "query-failed"; message: string }
  | { status: "missing-credential"; message: string }
  | { status: "not-emailable"; message: string };

export type RenderedReportEmail = {
  html: string;
  text: string;
  attachments: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
    contentId: string;
    disposition: "inline";
  }>;
  /** Panel ids that could not be rendered from real data. Empty === complete. */
  degradedPanelIds: string[];
};

type ReportAttachment = RenderedReportEmail["attachments"][number];

/**
 * Sits one layer above the panel source's own query timeout so the source's
 * more specific error surfaces first. The heaviest first-party panels on a real
 * dashboard need well over 20s.
 */
const DEFAULT_PANEL_TIMEOUT_MS = DASHBOARD_REPORT_ACTION_TIMEOUT_MS;
const EMAIL_TABLE_ROW_CAP = 50;
const MAX_CHART_POINTS = 400;
const CHART_WIDTH = 920;
const CHART_HEIGHT = 360;
const CHART_RASTER_SCALE = 2;
const MAX_TOTAL_ATTACHMENT_BYTES = 14 * 1024 * 1024;

/**
 * resvg resolves no CSS custom properties, so email charts cannot reuse the
 * dashboard's `var(--brand-*)` palette.
 */
/**
 * Mirrors `DEFAULT_COLORS` in `app/components/dashboard/SqlChart.tsx`, including
 * its length — series colors are assigned `index % length`, so a different
 * length would recolor every series past the first cycle relative to the live
 * dashboard. The first two entries resolve `var(--brand-blue)` / `--brand-teal`
 * to hex because resvg cannot read CSS custom properties.
 */
const CHART_COLORS = [
  "#0284c7",
  "#0d9488",
  "#06b6d4",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#14b8a6",
];

const TEXT_COLOR = "#111827";
const MUTED_COLOR = "#6b7280";
const BORDER_COLOR = "#e5e7eb";
const ERROR_BORDER_COLOR = "#dc2626";
const ERROR_BG_COLOR = "#fef2f2";

export function reportPanelVariables(
  snapshot: ReportSnapshot,
): Record<string, string> {
  const vars: Record<string, string> = { ...snapshot.variables };
  for (const [key, value] of Object.entries(snapshot.filters)) {
    if (key.startsWith("f_")) vars[key.slice(2)] = value;
  }
  return vars;
}

const SECRET_PATTERNS: RegExp[] = [
  /\b(?:bearer|token|api[_-]?key|secret|password|authorization)\b["'\s:=]+\S+/gi,
  /\b[A-Za-z0-9_-]{32,}\b/g,
];

function redactSecrets(message: string): string {
  const redacted = SECRET_PATTERNS.reduce(
    (acc, pattern) => acc.replace(pattern, "[redacted]"),
    message,
  );
  return redacted.length > 500 ? `${redacted.slice(0, 500)}…` : redacted;
}

function describeError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : JSON.stringify(error);
  return redactSecrets(raw || "Unknown error");
}

function panelFailureError(result: object): string | null {
  const error = (result as { error?: unknown }).error;
  return typeof error === "string" && error ? error : null;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
    void promise.catch(() => undefined);
  });
}

async function fetchOnePanel(
  panel: SqlPanel,
  vars: Record<string, string>,
  ctx: { userEmail: string; orgId: string | null },
  timeoutMs: number,
): Promise<ReportPanelData> {
  const source = panel.source as DashboardPanelSource;
  let query: string;
  try {
    query = normalizeDashboardPanelQuery(
      source,
      interpolate(serializePanelSql(panel.sql), vars, {
        failClosedTimeVariables: true,
      }),
    );
  } catch (error) {
    return { status: "query-failed", message: describeError(error) };
  }

  try {
    const result = await withTimeout(
      resolveAnalyticsPanelSource({ source, query, timeoutMs }, ctx),
      timeoutMs,
      `Panel query timed out after ${Math.round(timeoutMs / 1000)}s`,
    );
    const failure = panelFailureError(result);
    if (failure === "missing_api_key") {
      const message = (result as { message?: unknown }).message;
      return {
        status: "missing-credential",
        message: redactSecrets(
          typeof message === "string" && message
            ? message
            : "This panel's data source is not connected",
        ),
      };
    }
    if (failure) {
      const message = (result as { message?: unknown }).message;
      return {
        status: "query-failed",
        message: redactSecrets(
          typeof message === "string" && message ? message : failure,
        ),
      };
    }

    const rows = (result as { rows?: unknown }).rows;
    if (!Array.isArray(rows)) {
      return {
        status: "query-failed",
        message: "Panel source returned no row set",
      };
    }
    const schema = (result as { schema?: unknown }).schema;
    return {
      status: "rows",
      rows: rows as Array<Record<string, unknown>>,
      schema: Array.isArray(schema)
        ? (schema as Array<{ name: string; type: string }>)
        : [],
      ...((result as { truncated?: unknown }).truncated
        ? { truncated: true }
        : {}),
    };
  } catch (error) {
    return { status: "query-failed", message: describeError(error) };
  }
}

export async function fetchReportPanelData(args: {
  ownerEmail: string;
  orgId?: string | null;
  snapshot: ReportSnapshot;
  perPanelTimeoutMs?: number;
  deadlineAt?: number;
}): Promise<Map<string, ReportPanelData>> {
  const results = new Map<string, ReportPanelData>();
  const queue: SqlPanel[] = [];

  for (const panel of args.snapshot.panels ?? []) {
    if (panel.chartType === "section") continue;
    if (panel.chartType === "extension") {
      results.set(panel.id, {
        status: "not-emailable",
        message: "Extension panels only render in the live dashboard",
      });
      continue;
    }
    queue.push(panel);
  }

  const ownerEmail = args.ownerEmail?.trim();
  if (!ownerEmail) {
    for (const panel of queue) {
      results.set(panel.id, {
        status: "missing-credential",
        message:
          "This report has no subscription owner, so its panels cannot be queried under a scoped identity",
      });
    }
    return results;
  }

  const vars = reportPanelVariables(args.snapshot);
  const ctx = { userEmail: ownerEmail, orgId: args.orgId ?? null };
  const perPanelTimeoutMs = Math.max(
    1,
    args.perPanelTimeoutMs ?? DEFAULT_PANEL_TIMEOUT_MS,
  );

  const runQueue = async (
    panelQueue: SqlPanel[],
    concurrency: number,
  ): Promise<void> => {
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < panelQueue.length) {
        const panel = panelQueue[next++];
        const remaining = args.deadlineAt
          ? args.deadlineAt - Date.now()
          : Infinity;
        if (remaining <= 0) {
          results.set(panel.id, {
            status: "query-failed",
            message:
              "The report delivery deadline passed before this panel could run",
          });
          continue;
        }
        results.set(
          panel.id,
          await fetchOnePanel(
            panel,
            vars,
            ctx,
            Math.min(perPanelTimeoutMs, remaining),
          ),
        );
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, panelQueue.length) }, () =>
        worker(),
      ),
    );
  };

  await runWithRequestContext(
    { userEmail: ownerEmail, ...(args.orgId ? { orgId: args.orgId } : {}) },
    async () => {
      await Promise.all([
        runQueue(
          queue.filter((panel) => panel.source === "first-party"),
          MAX_CONCURRENT_FIRST_PARTY_SQL_QUERIES,
        ),
        runQueue(
          queue.filter((panel) => panel.source !== "first-party"),
          MAX_CONCURRENT_SQL_QUERIES,
        ),
      ]);
    },
  );

  return results;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isNumericLike(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    Number.isFinite(Number(value))
  );
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatYValue(
  value: number,
  formatter?: "number" | "currency" | "percent",
): string {
  if (formatter === "currency") return `$${value.toLocaleString()}`;
  if (formatter === "percent") {
    const pct = value <= 1 && value >= -1 ? value * 100 : value;
    return `${pct.toFixed(2)}%`;
  }
  return value.toLocaleString();
}

function formatMetricValue(
  raw: unknown,
  formatter?: "number" | "currency" | "percent",
  valueLabels?: Record<string, string>,
): string {
  const label = valueLabels?.[String(raw)];
  if (label !== undefined) return label;
  const numeric = toNumber(raw);
  return numeric !== null
    ? formatYValue(numeric, formatter)
    : String(raw ?? "-");
}

function formatCell(value: unknown, format: ColumnFormat | undefined): string {
  if (value == null) return "";
  if (typeof value === "number") {
    if (format === "number") return value.toLocaleString();
    if (format === "currency") return `$${value.toLocaleString()}`;
    if (format === "percent") {
      const pct = value <= 1 && value >= -1 ? value * 100 : value;
      return `${pct.toFixed(2)}%`;
    }
    if (format === "delta") {
      return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
    }
  }
  if (format === "date") {
    const date = new Date(String(value));
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    }
  }
  return String(value);
}

function safeLinkHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const href = value.trim();
  if (!href || href.startsWith("//") || href.startsWith("/")) return null;
  try {
    const parsed = new URL(href);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? href
      : null;
  } catch {
    return null;
  }
}

function detectMetricValueColumn(
  row: Record<string, unknown>,
  configuredKey?: string,
): string {
  const cols = Object.keys(row);
  if (configuredKey && cols.includes(configuredKey)) return configuredKey;
  return cols.find((key) => isNumericLike(row[key])) || cols[0] || "";
}

function detectChartKeys(
  rows: Array<Record<string, unknown>>,
  config: SqlPanel["config"],
  forcedYKeys?: string[],
): { xKey: string; yKeys: string[] } {
  if (rows.length === 0) return { xKey: "", yKeys: [] };
  const cols = Object.keys(rows[0]);
  const colSet = new Set(cols);
  const sample = rows[0];

  let xKey = config?.xKey && colSet.has(config.xKey) ? config.xKey : "";
  if (!xKey) {
    xKey =
      cols.find((col) => {
        const value = sample[col];
        return (
          typeof value === "string" &&
          value.length >= 8 &&
          !Number.isNaN(new Date(value).getTime())
        );
      }) ||
      cols.find((col) => typeof sample[col] === "string") ||
      cols[0];
  }

  if (forcedYKeys?.length) {
    return { xKey, yKeys: forcedYKeys.filter((key) => colSet.has(key)) };
  }

  const yKeys = (config?.yKeys ?? (config?.yKey ? [config.yKey] : [])).filter(
    (key) => colSet.has(key),
  );
  if (yKeys.length === 0) {
    for (const col of cols) {
      if (col === xKey) continue;
      if (isNumericLike(sample[col])) yKeys.push(col);
    }
  }
  if (yKeys.length === 0 && cols.length > 1) {
    yKeys.push(cols.find((col) => col !== xKey) || cols[1]);
  }
  return { xKey, yKeys };
}

function chartColor(config: SqlPanel["config"], index: number): string {
  const configured = config?.colors?.[index];
  return configured && !configured.includes("var(")
    ? configured
    : CHART_COLORS[index % CHART_COLORS.length];
}

function formatReportSeriesLabel(panel: SqlPanel, value: string): string {
  if (panel.source !== "prometheus" && panel.source !== "demo") return value;
  const match = /^(.*?)\{(.*)\}$/.exec(value.trim());
  if (!match) return value;

  const labels: Record<string, string> = {};
  const re = /([A-Za-z_][A-Za-z0-9_]*)="((?:\\.|[^"\\])*)"/g;
  let labelMatch: RegExpExecArray | null;
  while ((labelMatch = re.exec(match[2]))) {
    labels[labelMatch[1]] = labelMatch[2]
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }

  const preferred = [
    "device",
    "mountpoint",
    "fstype",
    "cpu",
    "mode",
    "state",
    "collector",
    "name",
    "route",
    "status",
    "phase",
    "dependency",
    "type",
    "quantile",
    "le",
  ];
  const descriptors = preferred
    .filter((key) => labels[key])
    .slice(0, 2)
    .map((key) => `${key}=${labels[key]}`);
  return descriptors.length
    ? `${descriptors.join(" ")} ${match[1]}`
    : match[1] || value;
}

/** Legacy saved dashboards still carry `stacked-bar` / `stacked-area`. */
const REPORT_CHART_TYPES: Record<string, ReportChartType> = {
  bar: "bar",
  line: "line",
  area: "area",
  pie: "pie",
  funnel: "funnel",
  "stacked-bar": "bar",
  "stacked-area": "area",
};

/**
 * The dashboard pivots before it picks a renderer, so tables, metrics, and
 * heatmaps see wide-form rows too. `fillDateGaps` must stay off for bar charts
 * (on the stored chart type, not the normalized one) because a filled day is a
 * fabricated zero bar, not a measurement.
 */
function pivotPanelRows(
  panel: SqlPanel,
  rows: Array<Record<string, unknown>>,
): { rows: Array<Record<string, unknown>>; forcedYKeys?: string[] } {
  if (!panel.config?.pivot || rows.length === 0) return { rows };
  const pivoted = pivotRows(rows, panel.config.pivot, {
    fillDateGaps: panel.chartType !== "bar",
  });
  return { rows: pivoted.rows, forcedYKeys: pivoted.seriesKeys };
}

type ChartInput = {
  labels: string[];
  series: ReportChartSeries[];
  droppedPoints: number;
};

function buildChartInput(
  panel: SqlPanel,
  rows: Array<Record<string, unknown>>,
  chartType: ReportChartType,
  forcedYKeys: string[] | undefined,
): ChartInput | null {
  const config = panel.config;
  const { xKey, yKeys } = detectChartKeys(rows, config, forcedYKeys);
  if (!xKey || yKeys.length === 0) return null;

  const droppedPoints = Math.max(0, rows.length - MAX_CHART_POINTS);
  const visible = droppedPoints ? rows.slice(-MAX_CHART_POINTS) : rows;
  const labels = visible.map((row) => String(row[xKey] ?? ""));
  const plotted = chartType === "pie" ? yKeys.slice(0, 1) : yKeys;
  const dualAxis = resolveDualAxis(plotted, config);
  const formatterFor = (key: string): ReportChartValueFormatter | undefined =>
    dualAxis.formatterFor(key);

  return {
    labels,
    series: plotted.map((key, index) => ({
      label: formatReportSeriesLabel(panel, key),
      data: visible.map((row) => toNumber(row[key])),
      color: chartColor(config, index),
      ...(dualAxis.enabled ? { axis: dualAxis.sideFor(key) } : {}),
      ...(formatterFor(key) ? { formatter: formatterFor(key) } : {}),
    })),
    droppedPoints,
  };
}

async function rasterizeChartPng(svg: string, width: number): Promise<Buffer> {
  const { Resvg } = await import("@resvg/resvg-js");
  const fontFiles = resolveOgFontFiles();
  // The fonts are embedded in core and only fail to materialize if tmpdir is
  // unwritable. Falling back to system fonts would render every label blank on
  // a Linux serverless runtime and still produce a valid-looking PNG, so refuse
  // instead — the caller turns this into a visible degraded panel.
  if (!fontFiles?.length) {
    throw new Error(
      "Chart fonts are unavailable (could not materialize the bundled font files), so chart text would render blank",
    );
  }
  const rendered = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: {
      loadSystemFonts: false,
      fontFiles,
      defaultFontFamily: REPORT_CHART_FONT_FAMILY,
      sansSerifFamily: REPORT_CHART_FONT_FAMILY,
    },
  }).render();
  return Buffer.from(rendered.asPng());
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const segment = (((hue % 360) + 360) % 360) / 60;
  const secondary = chroma * (1 - Math.abs((segment % 2) - 1));
  const base = [
    [chroma, secondary, 0],
    [secondary, chroma, 0],
    [0, chroma, secondary],
    [0, secondary, chroma],
    [secondary, 0, chroma],
    [chroma, 0, secondary],
  ][Math.floor(segment) % 6];
  const offset = l - chroma / 2;
  return `#${base
    .map((channel) =>
      Math.round((channel + offset) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

const CELL_STYLE = `padding:6px 8px;border-bottom:1px solid ${BORDER_COLOR};font-size:13px;color:${TEXT_COLOR};`;
const HEAD_CELL_STYLE = `padding:6px 8px;border-bottom:1px solid ${BORDER_COLOR};font-size:12px;font-weight:600;color:${MUTED_COLOR};text-align:left;`;

function noteHtml(text: string): string {
  return `<p style="margin:6px 0 0;font-size:12px;color:${MUTED_COLOR};">${escapeHtml(text)}</p>`;
}

function renderMetricHtml(
  panel: SqlPanel,
  rows: Array<Record<string, unknown>>,
): { html: string; text: string } {
  if (rows.length === 0) {
    return { html: noteHtml("No rows returned."), text: "No rows returned." };
  }
  const valueColumn = detectMetricValueColumn(rows[0], panel.config?.yKey);
  const raw =
    rows.length > 1 && isNumericLike(rows[0][valueColumn])
      ? rows.reduce((sum, row) => sum + (toNumber(row[valueColumn]) ?? 0), 0)
      : rows[0][valueColumn];
  const value = formatMetricValue(
    raw,
    panel.config?.yFormatter,
    panel.config?.valueLabels,
  );
  return {
    html: `<p style="margin:0;font-size:30px;font-weight:700;color:${TEXT_COLOR};">${escapeHtml(value)}</p>`,
    text: value,
  };
}

function renderCalloutHtml(rows: Array<Record<string, unknown>>): {
  html: string;
  text: string;
} {
  if (rows.length === 0) {
    return { html: noteHtml("No rows returned."), text: "No rows returned." };
  }
  const palette = {
    critical: { border: "#dc2626", background: "#fef2f2", text: "#991b1b" },
    warning: { border: "#d97706", background: "#fffbeb", text: "#92400e" },
    info: { border: "#0284c7", background: "#f0f9ff", text: "#075985" },
  } as const;
  const lines: string[] = [];
  const html = rows
    .map((row) => {
      const severityRaw = String(row.severity ?? "info").toLowerCase();
      const severity =
        severityRaw === "critical" || severityRaw === "warning"
          ? severityRaw
          : "info";
      const message = String(row.message ?? "");
      lines.push(`${severity.toUpperCase()}: ${message}`);
      const colors = palette[severity];
      return `<p style="margin:0 0 6px;padding:8px 10px;border:1px solid ${colors.border};background:${colors.background};color:${colors.text};font-size:13px;">${escapeHtml(message)}</p>`;
    })
    .join("");
  return { html, text: lines.join("\n") };
}

function renderTableHtml(
  panel: SqlPanel,
  rows: Array<Record<string, unknown>>,
): { html: string; text: string } {
  if (rows.length === 0) {
    return { html: noteHtml("No rows returned."), text: "No rows returned." };
  }
  const rowKeys = new Set(Object.keys(rows[0]));
  const configured = (panel.config?.columns ?? []).filter(
    (column) => !column.hidden && rowKeys.has(column.key),
  );
  const columns: TableColumnConfig[] = configured.length
    ? configured
    : Object.keys(rows[0]).map((key) => ({ key }));

  const configLimit = panel.config?.limit;
  const limit = Math.min(
    configLimit ?? EMAIL_TABLE_ROW_CAP,
    EMAIL_TABLE_ROW_CAP,
  );
  const visible = rows.slice(0, limit);

  const head = columns
    .map(
      (column) =>
        `<th style="${HEAD_CELL_STYLE}">${escapeHtml(column.label ?? column.key)}</th>`,
    )
    .join("");
  const body = visible
    .map((row) => {
      const cells = columns
        .map((column) => {
          const raw = row[column.key];
          const formatted = formatCell(raw, column.format);
          if (column.format === "link") {
            const href = safeLinkHref(
              column.linkKey ? row[column.linkKey] : raw,
            );
            return `<td style="${CELL_STYLE}">${
              href
                ? `<a href="${escapeHtml(href)}" style="color:#2563eb;">${escapeHtml(formatted)}</a>`
                : escapeHtml(formatted)
            }</td>`;
          }
          return `<td style="${CELL_STYLE}">${escapeHtml(formatted)}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  const truncatedNote =
    rows.length > visible.length
      ? noteHtml(`Showing the first ${visible.length} of ${rows.length} rows.`)
      : "";

  const text = [
    columns.map((column) => column.label ?? column.key).join(" | "),
    ...visible.map((row) =>
      columns
        .map((column) => formatCell(row[column.key], column.format))
        .join(" | "),
    ),
    ...(rows.length > visible.length
      ? [`… ${rows.length - visible.length} more rows`]
      : []),
  ].join("\n");

  return {
    html: `<div style="overflow-x:auto;"><table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${truncatedNote}`,
    text,
  };
}

function renderHeatmapHtml(
  panel: SqlPanel,
  rows: Array<Record<string, unknown>>,
): { html: string; text: string } {
  if (rows.length === 0) {
    return { html: noteHtml("No rows returned."), text: "No rows returned." };
  }
  const config = panel.config;
  const cols = Object.keys(rows[0]);
  const sample = rows[0];
  const xKey =
    config?.xKey ||
    cols.find((col) => typeof sample[col] === "string") ||
    cols[0];
  const valueKey =
    config?.yKey ||
    cols.find((col) => col !== xKey && isNumericLike(sample[col])) ||
    cols[1] ||
    "";
  if (!valueKey) {
    return {
      html: noteHtml("No numeric column to render as a heatmap."),
      text: "No numeric column to render as a heatmap.",
    };
  }
  const rowKey =
    config?.color ||
    cols.find(
      (col) =>
        col !== xKey && col !== valueKey && typeof sample[col] === "string",
    ) ||
    "";

  const xValues: string[] = [];
  const yValues: string[] = [];
  const grid = new Map<string, number>();
  for (const row of rows) {
    const x = String(row[xKey] ?? "");
    const y = rowKey ? String(row[rowKey] ?? "") : "";
    if (!xValues.includes(x)) xValues.push(x);
    if (!yValues.includes(y)) yValues.push(y);
    const value = toNumber(row[valueKey]);
    if (value !== null) grid.set(`${x}\u0000${y}`, value);
  }

  const stats = new Map<string, { mean: number; std: number }>();
  for (const x of xValues) {
    const values = yValues
      .map((y) => grid.get(`${x}\u0000${y}`))
      .filter((value): value is number => value != null);
    if (values.length === 0) {
      stats.set(x, { mean: 0, std: 0 });
      continue;
    }
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    stats.set(x, { mean, std: Math.sqrt(variance) });
  }

  const cellBackground = (x: string, value: number | undefined) => {
    if (value == null) return "";
    const stat = stats.get(x);
    if (!stat) return "";
    const baseline = stat.std > 0 ? stat.std : Math.abs(stat.mean) || 1;
    const z = Math.max(-2, Math.min(2, (value - stat.mean) / baseline));
    const lightness = 90 - Math.min(2, Math.abs(z)) * 25;
    return `background-color:${hslToHex(z >= 0 ? 140 : 0, 60, lightness)};`;
  };

  const head = [
    `<th style="${HEAD_CELL_STYLE}">${escapeHtml(rowKey)}</th>`,
    ...xValues.map(
      (x) => `<th style="${HEAD_CELL_STYLE}">${escapeHtml(x)}</th>`,
    ),
  ].join("");
  const body = yValues
    .map((y) => {
      const cells = xValues
        .map((x) => {
          const value = grid.get(`${x}\u0000${y}`);
          return `<td style="${CELL_STYLE}${cellBackground(x, value)}text-align:right;">${
            value != null
              ? escapeHtml(formatYValue(value, config?.yFormatter))
              : ""
          }</td>`;
        })
        .join("");
      return `<tr><td style="${CELL_STYLE}">${escapeHtml(y || "—")}</td>${cells}</tr>`;
    })
    .join("");

  const text = [
    [rowKey, ...xValues].join(" | "),
    ...yValues.map((y) =>
      [
        y || "—",
        ...xValues.map((x) => {
          const value = grid.get(`${x}\u0000${y}`);
          return value != null ? formatYValue(value, config?.yFormatter) : "";
        }),
      ].join(" | "),
    ),
  ].join("\n");

  return {
    html: `<div style="overflow-x:auto;"><table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`,
    text,
  };
}

type PanelBlock = {
  panelId: string;
  html: string;
  text: string;
  attachment?: ReportAttachment;
  degraded?: boolean;
};

function panelCardHtml(panel: SqlPanel, body: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid ${BORDER_COLOR};border-radius:6px;margin:0 0 16px;"><tr><td style="padding:14px 16px;">
<p style="margin:0 0 10px;font-size:14px;font-weight:600;color:${TEXT_COLOR};">${escapeHtml(panel.title)}</p>
${body}
</td></tr></table>`;
}

function failureBlock(
  panel: SqlPanel,
  heading: string,
  message: string,
): PanelBlock {
  return {
    panelId: panel.id,
    degraded: true,
    html: panelCardHtml(
      panel,
      `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-left:3px solid ${ERROR_BORDER_COLOR};background:${ERROR_BG_COLOR};"><tr><td style="padding:10px 12px;">
<p style="margin:0;font-size:13px;font-weight:600;color:#991b1b;">${escapeHtml(heading)}</p>
<p style="margin:4px 0 0;font-size:13px;color:#7f1d1d;">${escapeHtml(message)}</p>
</td></tr></table>`,
    ),
    text: `${panel.title}: ${heading} — ${message}`,
  };
}

async function renderChartBlock(args: {
  panel: SqlPanel;
  rows: Array<Record<string, unknown>>;
  forcedYKeys?: string[];
  chartType: Exclude<ReportChartType, "funnel">;
  index: number;
  description: string;
}): Promise<PanelBlock> {
  const { panel, rows, chartType, index, description } = args;
  const input = buildChartInput(panel, rows, chartType, args.forcedYKeys);
  if (!input) {
    const table = renderTableHtml(panel, rows);
    return {
      panelId: panel.id,
      html: panelCardHtml(
        panel,
        `${table.html}${noteHtml("No chartable columns were returned, so the rows are shown as a table.")}`,
      ),
      text: `${panel.title}\n${table.text}`,
    };
  }

  const subtitleParts = [description].filter(Boolean);
  if (input.droppedPoints) {
    subtitleParts.push(
      `showing the last ${input.labels.length} of ${input.labels.length + input.droppedPoints} points`,
    );
  }
  const subtitle = subtitleParts.join(" · ");

  // The card heading directly above already names the panel; repeating it here
  // would read twice in a client that blocks images.
  const alt = `${chartType} chart of ${input.series
    .map((series) => series.label)
    .join(", ")}`;

  try {
    // Title and description stay in the surrounding HTML card: text there is
    // selectable, wraps instead of truncating, and cannot be duplicated by the
    // image beneath it.
    const svg = renderReportChartSvg({
      labels: input.labels,
      series: input.series,
      type: chartType,
      width: CHART_WIDTH,
      height: CHART_HEIGHT,
      ...(panel.config?.stacked === true ? { stacked: true } : {}),
    });
    const png = await rasterizeChartPng(svg, CHART_WIDTH * CHART_RASTER_SCALE);
    const slug =
      panel.id.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 40) || "panel";
    const contentId = `dashboard-report-panel-${index}-${slug}`;
    return {
      panelId: panel.id,
      html: panelCardHtml(
        panel,
        `<img src="cid:${contentId}" alt="${escapeHtml(alt)}" width="${CHART_WIDTH}" style="display:block;width:100%;max-width:${CHART_WIDTH}px;height:auto;border:0;" />${
          subtitle ? noteHtml(subtitle) : ""
        }`,
      ),
      text: `${panel.title}: chart attached${subtitle ? ` (${subtitle})` : ""}`,
      attachment: {
        filename: `${slug}.png`,
        content: png,
        contentType: "image/png",
        contentId,
        disposition: "inline",
      },
    };
  } catch (error) {
    return failureBlock(
      panel,
      "Chart could not be rendered",
      describeError(error),
    );
  }
}

async function renderFunnelChartBlock(args: {
  panel: SqlPanel;
  rows: Array<Record<string, unknown>>;
  index: number;
  description: string;
}): Promise<PanelBlock> {
  const { panel, rows, index, description } = args;
  const funnel = resolveDashboardFunnelRows(
    rows,
    panel.config?.xKey,
    panel.config?.yKey,
  );
  if (funnel.items.length === 0) {
    const table = renderTableHtml(panel, rows);
    return {
      panelId: panel.id,
      html: panelCardHtml(
        panel,
        `${table.html}${noteHtml("No funnel stages were returned, so the rows are shown as a table.")}`,
      ),
      text: `${panel.title}\n${table.text}`,
    };
  }

  const subtitle = description;
  const alt = `funnel chart of ${funnel.items.map((item) => item.label).join(", ")}`;
  try {
    const svg = renderFunnelChartSvg({
      title: "",
      subtitle,
      rows: funnel.items,
      width: CHART_WIDTH,
      height: CHART_HEIGHT,
      formatter: panel.config?.yFormatter,
      colors: panel.config?.colors,
    });
    const png = await rasterizeChartPng(svg, CHART_WIDTH * CHART_RASTER_SCALE);
    const slug =
      panel.id.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 40) || "panel";
    const contentId = `dashboard-report-panel-${index}-${slug}`;
    return {
      panelId: panel.id,
      html: panelCardHtml(
        panel,
        `<img src="cid:${contentId}" alt="${escapeHtml(alt)}" width="${CHART_WIDTH}" style="display:block;width:100%;max-width:${CHART_WIDTH}px;height:auto;border:0;" />`,
      ),
      text: `${panel.title}: chart attached${subtitle ? ` (${subtitle})` : ""}`,
      attachment: {
        filename: `${slug}.png`,
        content: png,
        contentType: "image/png",
        contentId,
        disposition: "inline",
      },
    };
  } catch (error) {
    return failureBlock(
      panel,
      "Chart rendering failed",
      error instanceof Error
        ? error.message
        : "The funnel image could not be rendered.",
    );
  }
}

function enforceAttachmentBudget(blocks: PanelBlock[]): void {
  const totalBytes = () =>
    blocks.reduce(
      (sum, block) => sum + (block.attachment?.content.byteLength ?? 0),
      0,
    );

  while (totalBytes() > MAX_TOTAL_ATTACHMENT_BYTES) {
    let largest: PanelBlock | undefined;
    for (const block of blocks) {
      if (!block.attachment) continue;
      if (
        !largest?.attachment ||
        block.attachment.content.byteLength >
          largest.attachment.content.byteLength
      ) {
        largest = block;
      }
    }
    if (!largest) return;
    const bytes = largest.attachment?.content.byteLength ?? 0;
    delete largest.attachment;
    largest.degraded = true;
    largest.html = largest.html.replace(
      /<img [^>]*>/,
      `<p style="margin:0;font-size:13px;color:#991b1b;">This chart image (${Math.round(bytes / 1024)} KB) was dropped to keep the email under the attachment size limit. Open the dashboard to see it.</p>`,
    );
    largest.text = `${largest.text} (chart image dropped: email attachment size limit)`;
  }
}

export async function renderReportEmail(args: {
  snapshot: ReportSnapshot;
  panelData: Map<string, ReportPanelData>;
}): Promise<RenderedReportEmail> {
  const { snapshot, panelData } = args;
  const vars = reportPanelVariables(snapshot);
  const blocks: PanelBlock[] = [];
  let chartIndex = 0;

  for (const panel of snapshot.panels ?? []) {
    const description = interpolate(panel.config?.description, vars);

    if (panel.chartType === "section") {
      blocks.push({
        panelId: panel.id,
        html: `<p style="margin:22px 0 10px;font-size:16px;font-weight:700;color:${TEXT_COLOR};">${escapeHtml(panel.title)}</p>${
          description ? noteHtml(description) : ""
        }`,
        text: `\n== ${panel.title} ==${description ? `\n${description}` : ""}`,
      });
      continue;
    }

    const data = panelData.get(panel.id);
    if (!data) {
      blocks.push(
        failureBlock(
          panel,
          "Panel data was never fetched",
          "This panel was not included in the report data pass.",
        ),
      );
      continue;
    }

    if (data.status === "query-failed") {
      blocks.push(failureBlock(panel, "Query failed", data.message));
      continue;
    }
    if (data.status === "missing-credential") {
      blocks.push(
        failureBlock(panel, "Data source not connected", data.message),
      );
      continue;
    }
    if (data.status === "not-emailable") {
      blocks.push({
        panelId: panel.id,
        html: panelCardHtml(
          panel,
          `<p style="margin:0;font-size:13px;color:${MUTED_COLOR};">${escapeHtml(data.message)}. <a href="${escapeHtml(snapshot.dashboardUrl)}" style="color:#2563eb;">Open the dashboard</a>.</p>`,
        ),
        text: `${panel.title}: ${data.message} — ${snapshot.dashboardUrl}`,
      });
      continue;
    }

    const truncatedNote = data.truncated
      ? noteHtml("The source truncated this result set.")
      : "";
    const { rows, forcedYKeys } = pivotPanelRows(panel, data.rows);

    const chartType: ReportChartType | undefined =
      REPORT_CHART_TYPES[panel.chartType];
    if (chartType) {
      if (chartType === "funnel") {
        const block = await renderFunnelChartBlock({
          panel,
          rows,
          index: chartIndex++,
          description,
        });
        if (truncatedNote) block.html += truncatedNote;
        blocks.push(block);
        continue;
      }
      const block = await renderChartBlock({
        panel,
        rows,
        ...(forcedYKeys ? { forcedYKeys } : {}),
        chartType,
        index: chartIndex++,
        description,
      });
      if (truncatedNote) block.html += truncatedNote;
      blocks.push(block);
      continue;
    }

    const rendered =
      panel.chartType === "metric"
        ? renderMetricHtml(panel, rows)
        : panel.chartType === "callout"
          ? renderCalloutHtml(rows)
          : panel.chartType === "heatmap"
            ? renderHeatmapHtml(panel, rows)
            : renderTableHtml(panel, rows);

    blocks.push({
      panelId: panel.id,
      html: panelCardHtml(
        panel,
        `${rendered.html}${description ? noteHtml(description) : ""}${truncatedNote}`,
      ),
      text: `${panel.title}\n${rendered.text}`,
    });
  }

  enforceAttachmentBudget(blocks);

  const filterLine = Object.entries(snapshot.filters)
    // `tab` rides along in a subscription's saved filters, but a report renders
    // every tab's panels on purpose, so listing it would claim a filter that
    // was not applied.
    .filter(([key, value]) => value && key !== "tab")
    .map(
      ([key, value]) =>
        `${key.startsWith("f_") ? key.slice(2) : key}: ${value}`,
    )
    .join(" · ");

  const degradedPanelIds = [
    ...new Set(
      blocks.filter((block) => block.degraded).map((block) => block.panelId),
    ),
  ];

  const degradedBanner = degradedPanelIds.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-left:3px solid ${ERROR_BORDER_COLOR};background:${ERROR_BG_COLOR};margin:0 0 16px;"><tr><td style="padding:10px 12px;font-size:13px;color:#991b1b;">${degradedPanelIds.length} of ${snapshot.panelIds.length} panels could not be rendered from real data. This report is incomplete.</td></tr></table>`
    : "";

  const html = `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#ffffff;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:960px;font-family:Helvetica,Arial,sans-serif;"><tr><td>
<p style="margin:0 0 4px;font-size:20px;font-weight:700;color:${TEXT_COLOR};">${escapeHtml(snapshot.title)}</p>
${snapshot.description ? `<p style="margin:0 0 4px;font-size:13px;color:${MUTED_COLOR};">${escapeHtml(snapshot.description)}</p>` : ""}
<p style="margin:0 0 16px;font-size:12px;color:${MUTED_COLOR};">${escapeHtml(new Date(snapshot.generatedAt).toUTCString())}${filterLine ? ` · ${escapeHtml(filterLine)}` : ""}</p>
${degradedBanner}
${blocks.map((block) => block.html).join("\n")}
<p style="margin:20px 0 0;font-size:12px;color:${MUTED_COLOR};"><a href="${escapeHtml(snapshot.dashboardUrl)}" style="color:#2563eb;">Open dashboard</a> · <a href="${escapeHtml(snapshot.reportSettingsUrl)}" style="color:#2563eb;">Manage this report</a></p>
</td></tr></table>
</td></tr></table>`;

  const text = [
    snapshot.title,
    ...(snapshot.description ? [snapshot.description] : []),
    new Date(snapshot.generatedAt).toUTCString(),
    ...(filterLine ? [filterLine] : []),
    ...(degradedPanelIds.length
      ? [
          `INCOMPLETE REPORT: ${degradedPanelIds.length} of ${snapshot.panelIds.length} panels could not be rendered (${degradedPanelIds.join(", ")}).`,
        ]
      : []),
    "",
    ...blocks.map((block) => block.text),
    "",
    `Dashboard: ${snapshot.dashboardUrl}`,
    `Manage this report: ${snapshot.reportSettingsUrl}`,
  ].join("\n");

  return {
    html,
    text,
    attachments: blocks
      .map((block) => block.attachment)
      .filter((attachment): attachment is ReportAttachment =>
        Boolean(attachment),
      ),
    degradedPanelIds,
  };
}
