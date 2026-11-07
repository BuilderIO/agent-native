import { z } from "zod";

import type { EmbedVisibility } from "./embed-audience.js";

/**
 * The contract between Analytics and an app that keeps a frozen copy of one
 * dashboard panel, such as a chart in a Content page. Analytics owns the
 * query, access and chart semantics; the other app stores the returned
 * numbers and draws them with toolkit's report chart renderer.
 */

/** Panels drawn as charts from the stored rows. */
export const ANALYTICS_CAPTURE_CHART_TYPES = [
  "line",
  "area",
  "bar",
  "combo",
  "pie",
  "funnel",
] as const;

/** Every panel type a capture can hold. */
export const ANALYTICS_CAPTURE_PANEL_TYPES = [
  ...ANALYTICS_CAPTURE_CHART_TYPES,
  "metric",
  "table",
] as const;

export type AnalyticsCaptureChartType =
  (typeof ANALYTICS_CAPTURE_CHART_TYPES)[number];
export type AnalyticsCapturePanelType =
  (typeof ANALYTICS_CAPTURE_PANEL_TYPES)[number];

/** Most rows a capture keeps; enough for a daily chart over a year. */
export const ANALYTICS_CAPTURE_MAX_ROWS = 400;
/** Most rows a table capture keeps, matching what a report email shows. */
export const ANALYTICS_CAPTURE_MAX_TABLE_ROWS = 50;
export const ANALYTICS_CAPTURE_MAX_COLUMNS = 24;
const MAX_FILTERS = 40;
const MAX_CELL_TEXT = 500;

const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._-]+$/, "Use the id from the panel's copied link.");

const filtersSchema = z
  .record(z.string().trim().min(1).max(100), z.string().max(500))
  .refine((value) => Object.keys(value).length <= MAX_FILTERS, {
    message: `At most ${MAX_FILTERS} filters.`,
  });

const httpUrlSchema = z
  .string()
  .max(4096)
  .refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password
    );
  }, "Expected an http(s) URL.");

const visibilitySchema = z.enum(["private", "org", "public"]);

const colorSchema = z
  .string()
  .regex(/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i, "Expected a hex color.");

export const analyticsCaptureCellSchema = z.union([
  z.string().max(MAX_CELL_TEXT),
  z.number(),
  z.boolean(),
  z.null(),
]);
export type AnalyticsCaptureCell = z.infer<typeof analyticsCaptureCellSchema>;

export const analyticsCaptureSeriesSchema = z.object({
  label: z.string().max(200),
  color: colorSchema.optional(),
  axis: z.enum(["left", "right"]).optional(),
  formatter: z.enum(["number", "currency", "percent", "duration"]).optional(),
  /** Combo charts only: draw this series as bars or as a line. */
  mark: z.enum(["bar", "line"]).optional(),
});
export type AnalyticsCaptureSeries = z.infer<
  typeof analyticsCaptureSeriesSchema
>;

export const analyticsCaptureKeyDateSchema = z.object({
  /** The x value (first column) the date falls on. */
  x: z.string().max(200),
  label: z.string().max(200),
  color: colorSchema.optional(),
});
export type AnalyticsCaptureKeyDate = z.infer<
  typeof analyticsCaptureKeyDateSchema
>;

export const analyticsPanelCaptureRequestSchema = z.object({
  dashboardId: idSchema.describe("Dashboard id, from the panel's copied link."),
  panelId: idSchema.describe(
    "Panel id, the `tile` parameter of the panel's copied link.",
  ),
  filters: filtersSchema
    .optional()
    .describe(
      "Filter values keyed by filter id, as the dashboard URL carries them without the f_ prefix, e.g. {timeRange: '90d'}. Omit for the dashboard's defaults.",
    ),
});
export type AnalyticsPanelCaptureRequest = z.infer<
  typeof analyticsPanelCaptureRequestSchema
>;

export const analyticsPanelCaptureSchema = z.object({
  dashboard: z.object({
    id: idSchema,
    title: z.string().max(300),
    url: httpUrlSchema,
    /** Who can open the dashboard right now, as Analytics stores it. */
    visibility: visibilitySchema,
  }),
  panel: z.object({
    id: idSchema,
    title: z.string().max(300),
    type: z.enum(ANALYTICS_CAPTURE_PANEL_TYPES),
    /** Changes when the panel's saved query or chart settings change. */
    fingerprint: z.string().regex(/^[a-f0-9]{12}$/),
    url: httpUrlSchema,
  }),
  /** The filter values the numbers were captured with, keyed by filter id. */
  filters: filtersSchema,
  /** The same filters as one short line for people, e.g. "Last 90 days". */
  filterSummary: z.string().max(500).optional(),
  /**
   * Charts: the x value first, then one column per series. Metric: one
   * column. Table: the panel's visible columns.
   */
  columns: z
    .array(z.string().max(200))
    .min(1)
    .max(ANALYTICS_CAPTURE_MAX_COLUMNS),
  rows: z
    .array(
      z.array(analyticsCaptureCellSchema).max(ANALYTICS_CAPTURE_MAX_COLUMNS),
    )
    .max(ANALYTICS_CAPTURE_MAX_ROWS),
  /** Charts only: how to draw each column after the first. */
  series: z
    .array(analyticsCaptureSeriesSchema)
    .max(ANALYTICS_CAPTURE_MAX_COLUMNS)
    .optional(),
  stacked: z.boolean().optional(),
  keyDates: z.array(analyticsCaptureKeyDateSchema).max(100).optional(),
  /** Metric only: the value as the dashboard shows it, and its comparison. */
  display: z
    .object({
      value: z.string().max(200),
      comparison: z.string().max(300).optional(),
    })
    .optional(),
  /** True when the panel returned more rows than the capture keeps. */
  truncated: z.boolean(),
  capturedAt: z.string().datetime(),
});
export type AnalyticsPanelCapture = z.infer<typeof analyticsPanelCaptureSchema>;

export const analyticsPanelStatusRequestSchema = z.object({
  dashboardId: idSchema.describe("Dashboard id."),
  panelIds: z
    .array(idSchema)
    .max(50)
    .default([])
    .describe("Panels to report on; empty for the dashboard's sharing only."),
});
export type AnalyticsPanelStatusRequest = z.infer<
  typeof analyticsPanelStatusRequestSchema
>;

export const analyticsPanelStatusSchema = z.object({
  dashboard: z.object({
    id: idSchema,
    title: z.string().max(300),
    visibility: visibilitySchema,
  }),
  panels: z
    .array(
      z.object({
        id: idSchema,
        /** Null when the panel is gone from the dashboard. */
        fingerprint: z
          .string()
          .regex(/^[a-f0-9]{12}$/)
          .nullable(),
        type: z.string().max(40).nullable(),
      }),
    )
    .max(50),
});
export type AnalyticsPanelStatus = z.infer<typeof analyticsPanelStatusSchema>;

/** The dashboard's sharing as an embed audience check reads it. */
export function analyticsDashboardVisibility(
  status: Pick<AnalyticsPanelStatus, "dashboard"> | null | undefined,
): EmbedVisibility | null {
  return status?.dashboard.visibility ?? null;
}

const FILTER_PARAM_PREFIX = "f_";

/**
 * Reads a panel's copied link ("Copy link" on a dashboard panel):
 * `<analytics>/dashboards/<id>?f_<filter>=…&tile=<panelId>`. Returns null for
 * anything else, including a dashboard link without a panel. `origins` are
 * the Analytics origins this deployment trusts; the link may carry an app
 * base path such as `/analytics`.
 */
export function parseAnalyticsPanelLink(
  value: string,
  origins: readonly string[],
): AnalyticsPanelCaptureRequest | null {
  const text = value.trim();
  if (!text || /\s/.test(text) || !URL.canParse(text)) return null;
  const url = new URL(text);
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  const trusted = origins.some((origin) => {
    if (!URL.canParse(origin)) return false;
    return new URL(origin).origin === url.origin;
  });
  if (!trusted) return null;
  const match = /(?:^|\/)dashboards\/([^/]+)\/?$/.exec(url.pathname);
  if (!match) return null;
  let dashboardId: string;
  try {
    dashboardId = decodeURIComponent(match[1] ?? "");
    // coercion-ok: a malformed escape isn't a panel link, and null is this parser's "not a panel link"
  } catch {
    return null;
  }
  const panelId = url.searchParams.get("tile") ?? "";
  const filters: Record<string, string> = {};
  for (const [key, paramValue] of url.searchParams) {
    if (key.startsWith(FILTER_PARAM_PREFIX) && key.length > 2) {
      filters[key.slice(FILTER_PARAM_PREFIX.length)] = paramValue;
    }
  }
  const parsed = analyticsPanelCaptureRequestSchema.safeParse({
    dashboardId,
    panelId,
    ...(Object.keys(filters).length ? { filters } : {}),
  });
  return parsed.success ? parsed.data : null;
}
